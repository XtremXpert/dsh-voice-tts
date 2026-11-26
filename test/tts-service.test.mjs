import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS, mergeConfig, resolveConfig } from '../lib/config.js'
import { createSpeechService } from '../lib/server.js'
import { probe, resolveVoice, synthesizeWav } from '../lib/tts.js'
import { loadAppleVoices, parseAppleVoices } from '../lib/apple-voices.js'
import { chooseVoice, findVoice, listVoices, parseVoices, voiceArgument } from '../lib/voices.js'

/** Sortie de `say -v ?` telle qu'elle apparaît sur cette machine (extrait). */
const CATALOG = [
  'Amélie (Français (Canada)) fr_CA    # Bonjour! Je m’appelle Amélie.',
  'Eddy (Français (Canada)) fr_CA    # Bonjour! Je m’appelle Eddy.',
  'Flo (Français (Canada)) fr_CA    # Bonjour! Je m’appelle Flo.',
  'Reed (Français (Canada)) fr_CA    # Bonjour! Je m’appelle Reed.',
  'Thomas (Français (France)) fr_FR    # Bonjour, je m’appelle Thomas.',
  'Samantha en_US    # Hello! My name is Samantha.',
  'Amélie (Enhanced) (Français (Canada)) fr_CA    # Bonjour!',
  'Fló (Premium) (Français (France)) fr_FR    # Bonjour!',
].join('\n')

/** Section `tts` qui parle pour de vrai, sans dépendre d'une voix précise. */
const SAY_TTS = { ...DEFAULTS.tts, rate: 185, sampleRate: 24000, timeoutMs: 30000 }

/** Lit les morceaux RIFF d'un WAV (`say` peut intercaler des morceaux LIST). */
function wavFormat(wav) {
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE')
  const chunks = new Map()
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString('ascii')
    const size = wav.readUInt32LE(offset + 4)
    chunks.set(id, { at: offset + 8, size })
    offset += 8 + size + (size % 2)
  }
  const fmt = chunks.get('fmt ')
  const data = chunks.get('data')
  assert.ok(fmt && data, `morceaux manquants : ${[...chunks.keys()].join(', ')}`)
  return {
    channels: wav.readUInt16LE(fmt.at + 2),
    sampleRate: wav.readUInt32LE(fmt.at + 4),
    bits: wav.readUInt16LE(fmt.at + 14),
    dataBytes: data.size,
  }
}

test('parseVoices lit le catalogue de say, langues et qualités comprises', () => {
  const voices = parseVoices(CATALOG)
  assert.equal(voices.length, 8)
  const amelie = voices.find((voice) => voice.name === 'Amélie')
  assert.equal(amelie.locale, 'fr-CA')
  assert.equal(amelie.quality, 'compact')
  assert.equal(voices.find((voice) => voice.name === 'Thomas').locale, 'fr-FR')
  assert.equal(voices.find((voice) => voice.name === 'Amélie (Enhanced)').quality, 'enhanced')
  assert.equal(voices.find((voice) => voice.name === 'Fló (Premium)').quality, 'premium')
  assert.equal(voices.find((voice) => voice.name === 'Samantha').locale, 'en-US')
})

test('chooseVoice préfère une voix de meilleure qualité, puis la locale demandée', () => {
  const voices = parseVoices(CATALOG)
  assert.equal(chooseVoice(voices, { locale: 'fr-CA' }).name, 'Amélie (Enhanced)')
  // Sans variantes améliorées, Flo passe devant Amélie et les personnages.
  const plain = voices.filter((voice) => voice.quality === 'compact')
  assert.equal(chooseVoice(plain, { locale: 'fr-CA' }).name, 'Flo')
  // Une demande explicite gagne sur le classement.
  assert.equal(chooseVoice(voices, { locale: 'fr-CA', voice: 'Reed' }).name, 'Reed')
  // Une demande au nom sans marqueur retrouve la variante améliorée.
  assert.equal(chooseVoice(voices, { voice: 'Amélie' }).name, 'Amélie (Enhanced)')
  // Une demande inconnue ne casse rien : on retombe sur la meilleure disponible.
  assert.equal(chooseVoice(voices, { locale: 'fr-CA', voice: 'Zorglub' }).name, 'Amélie (Enhanced)')
})

test('findVoice est strict : une voix absente se voit', () => {
  const voices = parseVoices(CATALOG)
  assert.equal(findVoice(voices, 'Flo').name, 'Flo')
  assert.equal(findVoice(voices, 'Flo (Français (Canada))').name, 'Flo')
  assert.equal(findVoice(voices, 'Zorglub'), null)
})

test('say écrit un WAV mono 24 kHz avec la voix demandée', async () => {
  const { voice } = await resolveVoice({ ...SAY_TTS, voice: 'Flo' })
  assert.ok(voice, 'une voix française doit être installée')
  const result = await synthesizeWav('Bonjour, ceci est un essai de synthèse Apple.', SAY_TTS, voice)
  assert.equal(result.voice, voice.name)
  const format = wavFormat(result.wav)
  assert.equal(format.channels, 1)
  assert.equal(format.sampleRate, 24000)
  assert.equal(format.bits, 16)
  assert.ok(format.dataBytes > 8000, `audio trop court : ${format.dataBytes} octets`)
})

test('resolveConfig laisse l’environnement surcharger la voix, la langue et le débit', () => {
  const config = resolveConfig({}, {
    DSH_VOICE_TTS_PORT: '9040',
    DSH_VOICE_TTS_VOICE: 'Shelley',
    DSH_VOICE_TTS_LOCALE: 'fr-FR',
    DSH_VOICE_TTS_RATE: '200',
  })
  assert.equal(config.port, 9040)
  assert.equal(config.tts.voice, 'Shelley')
  assert.equal(config.tts.locale, 'fr-FR')
  assert.equal(config.tts.rate, 200)
})

test('mergeConfig fusionne en profondeur sans muter les défauts', () => {
  const merged = mergeConfig(DEFAULTS, { tts: { voice: 'Reed' }, maxTextChars: 500 })
  assert.equal(merged.tts.voice, 'Reed')
  assert.equal(merged.tts.rate, DEFAULTS.tts.rate)
  assert.equal(merged.maxTextChars, 500)
  assert.equal(DEFAULTS.tts.voice, '')
})

test('le catalogue Apple de cette machine liste le français', async () => {
  const voices = await listVoices({ refresh: true })
  assert.ok(voices.length > 20, `catalogue inattendu : ${voices.length} voix`)
  const french = voices.filter((voice) => /^fr\b/i.test(voice.locale))
  assert.ok(french.length >= 2, `voix françaises : ${french.map((voice) => voice.name).join(', ')}`)
  assert.ok(french.every((voice) => ['compact', 'enhanced', 'premium', 'siri'].includes(voice.quality)))
})

test('le service expose /status, /voices, /health et la synthèse', async () => {
  const config = resolveConfig({ port: 0, tts: SAY_TTS })
  const service = createSpeechService({ config, logger: { info() {} } })
  await service.start()
  const base = `http://127.0.0.1:${service.port()}`
  try {
    const status = await fetch(`${base}/status`)
    assert.equal(status.status, 200)
    assert.equal(status.headers.get('access-control-allow-origin'), '*')
    const body = await status.json()
    assert.equal(body.engine, 'say')
    assert.ok(typeof body.voice === 'string' && body.voice !== '')
    assert.equal(body.maxTextChars, config.maxTextChars)

    const voices = await (await fetch(`${base}/voices`)).json()
    assert.ok(voices.french.length >= 2)
    assert.equal(voices.chosen, body.voice)

    const health = await (await fetch(`${base}/health`)).json()
    assert.equal(health.ready, true)
    assert.equal(health.engine, 'say')

    const preflight = await fetch(`${base}/synthesize`, { method: 'OPTIONS' })
    assert.equal(preflight.status, 204)
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)

    const response = await fetch(`${base}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '## Titre\n\nLe **service** répond.\n\n```js\nconst x = 1\n```' }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/wav')
    assert.ok(response.headers.get('x-voice-name'))
    const spoken = Number(response.headers.get('x-spoken-chars'))
    assert.ok(spoken > 10 && spoken < 60, `texte parlé inattendu : ${spoken} caractères`)
    wavFormat(Buffer.from(await response.arrayBuffer()))

    const chosen = await fetch(`${base}/synthesize?voice=Flo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Une voix précise.' }),
    })
    assert.equal(chosen.status, 200)
    assert.equal(chosen.headers.get('x-voice-name'), 'Flo')
    // Le nom seul existe aussi en allemand : l'identifiant doit dire fr-CA.
    assert.equal(chosen.headers.get('x-voice-locale'), 'fr-CA')
    assert.match(chosen.headers.get('x-voice-identifier'), /fr-CA/)

    const unknown = await fetch(`${base}/synthesize?voice=Zorglub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Bonjour.' }),
    })
    assert.equal(unknown.status, 400)
    assert.match((await unknown.json()).error, /voix inconnue/)
  } finally {
    await service.stop()
  }
})

test('le service refuse un texte vide et une route inconnue', async () => {
  const config = resolveConfig({ port: 0, tts: SAY_TTS })
  const service = createSpeechService({ config })
  await service.start()
  const base = `http://127.0.0.1:${service.port()}`
  try {
    const empty = await fetch(`${base}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    assert.equal(empty.status, 400)
    const missing = await fetch(`${base}/nope`)
    assert.equal(missing.status, 404)
  } finally {
    await service.stop()
  }
})

test('probe décrit say et la voix retenue', async () => {
  const health = await probe(SAY_TTS)
  assert.equal(health.ready, true)
  assert.equal(health.engine, 'say')
  assert.ok(health.french >= 2)
  assert.ok(health.chosen && typeof health.chosen.name === 'string')
})

test('parseAppleVoices lit identifiant, langue et qualité', () => {
  const tsv = [
    'com.apple.eloquence.fr-CA.Flo\tFlo\tfr-CA\tcompact',
    'com.apple.voice.premium.fr-FR.Amelie\tAmélie\tfr-FR\tpremium',
    'com.apple.eloquence.de-DE.Flo\tFlo\tde-DE\tcompact',
    'ligne invalide',
  ].join('\n')
  const voices = parseAppleVoices(tsv)
  assert.equal(voices.length, 3)
  assert.equal(voices[0].identifier, 'com.apple.eloquence.fr-CA.Flo')
  assert.equal(voices[1].quality, 'premium')
  assert.equal(voices[2].locale, 'de-DE')
})

test('le catalogue AVFoundation donne des identifiants, et le choix reste français', async () => {
  const voices = await loadAppleVoices({ refresh: true })
  assert.ok(Array.isArray(voices) && voices.length > 20, 'AVFoundation doit répondre sur cette machine')
  const french = voices.filter((voice) => /^fr\b/i.test(voice.locale))
  assert.ok(french.length >= 2)
  assert.ok(french.every((voice) => voice.identifier.startsWith('com.apple.')))
  const chosen = chooseVoice(voices, { locale: 'fr-CA' })
  assert.equal(chosen.locale, 'fr-CA')
  assert.match(voiceArgument(chosen), /fr-CA/, 'say doit recevoir un identifiant qui dit la langue')
})

test('findVoice retrouve une voix accentuée quelle que soit la normalisation', async () => {
  const voices = await loadAppleVoices()
  const nfc = 'Amélie'.normalize('NFC')
  const nfd = 'Amélie'.normalize('NFD')
  assert.ok(findVoice(voices, nfc), 'nom en NFC')
  assert.ok(findVoice(voices, nfd), 'nom en NFD')
  assert.equal(findVoice(voices, nfc).locale, 'fr-CA')
})

test('voiceArgument préfère l’identifiant au nom', () => {
  assert.equal(voiceArgument({ identifier: 'com.apple.eloquence.fr-CA.Flo', name: 'Flo' }), 'com.apple.eloquence.fr-CA.Flo')
  assert.equal(voiceArgument({ identifier: '', name: 'Thomas' }), 'Thomas')
  assert.equal(voiceArgument(null), undefined)
})
