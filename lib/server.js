/**
 * Le service de synthèse que le navigateur appelle.
 *
 * La page Web de DSH est servie par le Host ; elle ne peut pas lancer `say`
 * elle-même. Ce service écoute donc sur la boucle locale, fait parler macOS et
 * renvoie un WAV que le navigateur joue. Rien ne sort de la machine, aucune
 * clé n'est lue, et le CORS n'autorise que ce qui est nécessaire : la page
 * peut demander un WAV, pas lire autre chose.
 */

import { createServer } from 'node:http'

import { pickSpoken } from './speech-text.js'
import { synthesizeWithPiper } from './piper.js'
import { probe, resolveVoice, synthesizeWav } from './tts.js'
import { chooseVoice, findVoice, listVoices } from './voices.js'

/** En-têtes communs : la page vient d'un autre port, sur la même machine. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'x-voice-source, x-voice-name, x-voice-locale, x-spoken-chars, x-truncated',
  'cache-control': 'no-store',
}

/**
 * Monter le service HTTP (sans l'écouter).
 * @param {object} options
 * @param {object} options.config configuration résolue
 * @param {object} [options.logger] journal du Host
 * @returns {{start: () => Promise<string>, stop: () => Promise<void>, url: string, port: () => number}}
 */
export function createSpeechService({ config, logger }) {
  /** Une synthèse à la fois : `say` sature vite et la page n'attend qu'une réponse. */
  let queue = Promise.resolve()
  let listening = 0
  let lastError = null

  /** Le catalogue change rarement : `listVoices` le garde une minute. */
  const catalog = async () => {
    try { return await listVoices() } catch { return [] }
  }

  const speak = (text, wantedVoice) => {
    const run = queue.then(async () => {
      listening += 1
      try {
        const voices = await catalog()
        let voice
        if (wantedVoice !== undefined) {
          voice = findVoice(voices, wantedVoice)
          if (voice === null) throw new BadRequest(`voix inconnue : ${wantedVoice}`)
        } else {
          voice = chooseVoice(voices, config.tts)
        }
        // Le résumé explicite d'abord ; sinon le début, coupé en fin de phrase.
        const limited = pickSpoken(text, config.maxTextChars)
        if (limited.text === '') throw new BadRequest('rien à prononcer après nettoyage')
        const { result, source } = await synthesize(limited.text, voice)
        return { ...result, source, spoken: limited.text, truncated: limited.truncated, locale: voice?.locale ?? null }
      } catch (error) {
        lastError = { time: new Date().toISOString(), message: messageOf(error) }
        throw error
      } finally {
        listening -= 1
      }
    })
    queue = run.catch(() => {})
    return run
  }

  /**
   * Synthèse par le moteur configuré, avec repli sur `say` : un Piper cassé ne
   * doit pas priver la page de voix, juste la rendre plus banale.
   * @param {string} text texte plafonné
   * @param {object | null} voice voix Apple déjà résolue
   */
  async function synthesize(text, voice) {
    if (config.tts.provider === 'piper') {
      try {
        return { result: await synthesizeWithPiper(text, config.tts.piper), source: 'piper' }
      } catch (error) {
        lastError = { time: new Date().toISOString(), message: `piper: ${messageOf(error)}` }
        logger?.warn?.(`voice-tts: Piper indisponible (${messageOf(error)}) — repli sur say`)
      }
    }
    return { result: await synthesizeWav(text, config.tts, voice), source: 'say' }
  }

  const server = createServer((request, response) => {
    void handle(request, response)
  })

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { ...CORS, ...headers })
      response.end(body)
    }
    const json = (status, body) => {
      const payload = JSON.stringify(body)
      send(status, payload, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
    }

    if (request.method === 'OPTIONS') return send(204, '')

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/status')) {
      const voice = chooseVoice(await catalog(), config.tts)
      return json(200, {
        ready: true,
        service: 'dsh-voice-tts',
        engine: config.tts.provider,
        voice: config.tts.provider === 'piper' ? config.tts.piper.name : (voice === null ? null : voice.name),
        voiceLocale: config.tts.provider === 'piper' ? null : (voice?.locale ?? null),
        voiceQuality: config.tts.provider === 'piper' ? null : (voice?.quality ?? null),
        voiceIdentifier: config.tts.provider === 'piper' ? null : (voice?.identifier ?? null),
        model: config.tts.provider === 'piper' ? config.tts.piper.model : null,
        locale: config.tts.locale,
        rate: config.tts.rate,
        maxTextChars: config.maxTextChars,
        busy: listening > 0,
        lastError,
      })
    }

    if (request.method === 'GET' && url.pathname === '/voices') {
      const voices = await listVoices({ refresh: true }).catch(() => [])
      const chosen = chooseVoice(voices, config.tts)
      const french = voices.filter((voice) => /^fr\b/i.test(voice.locale))
      return json(200, {
        chosen: chosen === null ? null : chosen.name,
        total: voices.length,
        french: french.map(brief),
        all: voices.length > 400 ? undefined : voices.map(brief),
      })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { ready: true, ...(await probe(config.tts)), lastError })
    }

    if (request.method === 'POST' && url.pathname === '/synthesize') {
      const body = await readBody(request, config.maxBodyBytes).catch((error) => {
        json(400, { error: messageOf(error) })
        return undefined
      })
      if (body === undefined) return
      let text
      try {
        text = JSON.parse(body.toString('utf8'))?.text
      } catch {
        return json(400, { error: 'JSON invalide' })
      }
      if (typeof text !== 'string' || text.trim() === '') return json(400, { error: 'texte requis' })
      const wanted = url.searchParams.get('voice') ?? undefined
      try {
        const result = await speak(text, wanted)
        logger?.info?.(`voice-tts: ${result.spoken.length} caractères dits par ${result.voice} (${result.source})`)
        return send(200, result.wav, {
          'content-type': 'audio/wav',
          'content-length': String(result.wav.length),
          'x-voice-source': result.source,
          'x-voice-name': result.voice,
          'x-voice-identifier': result.identifier ?? '',
          'x-voice-locale': result.locale ?? '',
          'x-spoken-chars': String(result.spoken.length),
          'x-truncated': result.truncated ? 'true' : 'false',
        })
      } catch (error) {
        return json(error instanceof BadRequest ? 400 : 502, { error: messageOf(error) })
      }
    }

    return json(404, { error: 'route inconnue' })
  }

  return {
    url: `http://${config.host}:${config.port}`,
    port: () => {
      const address = server.address()
      return typeof address === 'object' && address !== null ? address.port : config.port
    },
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return this.url
    },
    async stop() {
      await new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => { resolve() })
      })
    },
  }
}

/** Relire une chaîne reçue en UTF-8 brut comme si elle avait été décodée en latin1. */
function fromLatin1(value) {
  if (!/[-ÿ]/.test(value)) return value
  return Buffer.from(value, 'latin1').toString('utf8')
}

/** Description compacte d'une voix, pour les routes de découverte. */
function brief(voice) {
  return { name: voice.name, locale: voice.locale, quality: voice.quality, identifier: voice.identifier || null }
}

/** Erreur de demande : la faute vient du client, pas de la synthèse. */
class BadRequest extends Error {}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`corps trop gros (> ${maxBytes} octets)`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => { resolve(Buffer.concat(chunks)) })
    request.on('error', reject)
  })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
