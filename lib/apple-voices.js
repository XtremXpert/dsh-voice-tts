/**
 * Le catalogue des voix Apple, avec leurs identifiants.
 *
 * `say -v ?` ne donne que des noms, et un nom comme « Flo » ou « Thomas »
 * existe dans plusieurs langues : `say -v Flo` laisse alors le système
 * trancher, et sur cette machine il tranche pour l'allemand. L'identifiant
 * canonique (`com.apple.eloquence.fr-CA.Flo`) ne souffre pas d'ambiguïté, et
 * `say -v` l'accepte.
 *
 * Seule AVFoundation connaît ces identifiants : ce module compile `tools/voices.swift`
 * une fois (swiftc est livré avec les outils de développement Apple), garde le
 * binaire et la liste en cache dans le dossier temporaire, et retombe
 * proprement sur `say -v ?` si la compilation est impossible.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Emplacement du source Swift, dans le paquet. */
const SOURCE_PATH = fileURLToPath(new URL('../tools/voices.swift', import.meta.url))

/** Dossier de travail du cache (binaire + JSON), sous le temporaire du système. */
const CACHE_DIR = join(tmpdir(), 'dsh-voice-tts')

/** Une compilation peut être lente la première fois (outils Apple). */
const COMPILE_TIMEOUT_MS = 180000
const RUN_TIMEOUT_MS = 30000

let memo = { at: 0, voices: null }
const CACHE_MS = 3600000

/**
 * Charger (et mettre en cache) la liste AVFoundation des voix.
 * @param {object} [options]
 * @param {boolean} [options.refresh] ignorer le cache mémoire
 * @returns {Promise<Array<object> | null>} voix avec identifiant, ou null si indisponible
 */
export async function loadAppleVoices(options = {}) {
  if (options.refresh !== true && memo.voices !== null && Date.now() - memo.at < CACHE_MS) return memo.voices
  try {
    const source = await readFile(SOURCE_PATH, 'utf8')
    const hash = createHash('sha256').update(source).update(process.version).digest('hex').slice(0, 16)
    await mkdir(CACHE_DIR, { recursive: true })
    const binary = join(CACHE_DIR, `voices-${hash}`)
    const listing = join(CACHE_DIR, `voices-${hash}.tsv`)
    if (!(await exists(binary))) await compile(SOURCE_PATH, binary, hash)
    // La liste change dès qu'on installe une voix : on la refait à chaque
    // démarrage du service, pas à chaque phrase.
    const { stdout } = await run(binary, [], { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    await writeFile(listing, stdout, 'utf8').catch(() => {})
    const voices = parseAppleVoices(stdout)
    memo = { at: Date.now(), voices }
    return voices
  } catch {
    memo = { at: Date.now(), voices: null }
    return null
  }
}

async function compile(sourcePath, binary, hash) {
  const cache = join(CACHE_DIR, `swift-mc-${hash}`)
  await mkdir(cache, { recursive: true })
  await run('swiftc', ['-O', '-module-cache-path', cache, sourcePath, '-o', binary], { timeout: COMPILE_TIMEOUT_MS })
}

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

/**
 * Analyser la sortie du binaire : identifiant, nom, langue, qualité.
 * @param {string} stdout lignes séparées par des tabulations
 * @returns {Array<{identifier: string, name: string, locale: string, quality: string}>}
 */
export function parseAppleVoices(stdout) {
  const voices = []
  const seen = new Set()
  for (const line of String(stdout ?? '').split('\n')) {
    const [identifier, name, locale, quality] = line.split('\t')
    if (!identifier || !name || !locale) continue
    const key = identifier.trim()
    if (seen.has(key)) continue
    seen.add(key)
    voices.push({
      identifier: key,
      name: name.trim(),
      locale: locale.trim(),
      quality: normalizeQuality(quality),
      // Le nom affiché garde la langue : deux « Flo » se distinguent à l'écran.
      display: `${name.trim()} (${locale.trim()})`,
      sample: '',
    })
  }
  return voices
}

function normalizeQuality(raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === 'premium' || value === 'enhanced' ? value : 'compact'
}
