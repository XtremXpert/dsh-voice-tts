/**
 * Les voix Apple installées sur cette machine, et le choix de celle qui parle.
 *
 * Deux sources, dans cet ordre :
 *   1. AVFoundation (`tools/voices.swift`) : identifiant canonique, nom, langue
 *      et qualité — c'est la seule source exacte ;
 *   2. `say -v ?` : des noms nus, utiles quand la compilation Swift est
 *      impossible, mais ambigus (`Flo` existe en français ET en allemand, et
 *      `say` tranche pour l'allemand sur cette machine).
 *
 * C'est pourquoi une voix porte toujours `identifier` quand il est connu, et
 * que `say` reçoit cet identifiant plutôt que le nom.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loadAppleVoices } from './apple-voices.js'

const run = promisify(execFile)

/** Le catalogue ne change pas souvent : une minute de cache suffit. */
const CACHE_MS = 60000
let cache = { at: 0, voices: [] }

/** Ordre de préférence à qualité égale : les voix neutres avant les personnages. */
const PREFERRED = ['Flo', 'Shelley', 'Sandy', 'Amélie', 'Amelie', 'Eddy', 'Reed', 'Rocko', 'Jacques', 'Thomas', 'Grandma', 'Grandpa']

/**
 * Lire le catalogue des voix.
 * @param {object} [options]
 * @param {number} [options.timeout] délai de `say -v ?`
 * @param {boolean} [options.refresh] ignorer le cache
 * @returns {Promise<Array<object>>} voix normalisées, identifiant compris si disponible
 */
export async function listVoices(options = {}) {
  const fresh = options.refresh === true || Date.now() - cache.at > CACHE_MS
  if (!fresh) return cache.voices
  const apple = await loadAppleVoices({ refresh: options.refresh })
  const voices = apple ?? await sayCatalog(options).catch(() => [])
  cache = { at: Date.now(), voices }
  return voices
}

async function sayCatalog(options) {
  const { stdout } = await run('say', ['-v', '?'], {
    timeout: options.timeout ?? 5000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return parseVoices(stdout)
}

/**
 * Analyser la sortie de `say -v ?` (repli, exporté pour les tests).
 * @param {string} stdout lignes du catalogue
 * @returns {Array<object>} voix normalisées, sans identifiant
 */
export function parseVoices(stdout) {
  const voices = []
  const seen = new Set()
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.trimEnd()
    if (line === '' || line.startsWith(' ')) continue
    // « Flo (Français (Canada)) fr_CA    # Bonjour! Je m'appelle Flo. »
    const match = line.match(/^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z]{2,4})\s*(?:#\s*(.*))?$/)
      ?? line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z]{2,4})\s*(?:#\s*(.*))?$/)
    if (match === null) continue
    const full = match[1].trim()
    const locale = match[2].replace('_', '-')
    const sample = (match[3] ?? '').trim()
    const { name, localeName } = splitName(full)
    if (name === '') continue
    const entry = {
      identifier: '',
      name,
      display: localeName === '' ? name : `${name} (${localeName})`,
      locale,
      quality: qualityOf(name),
      sample,
    }
    // `say -v ?` répète parfois une même voix (Amélie, Thomas) : une entrée.
    const key = `${entry.name.toLowerCase()}|${entry.locale.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      voices.push(entry)
    }
  }
  return voices
}

/** Séparer « Thomas (Enhanced) (Français (France)) » en nom et langue affichée. */
function splitName(full) {
  if (!full.endsWith(')')) return { name: full, localeName: '' }
  let depth = 0
  for (let at = full.length - 1; at >= 0; at -= 1) {
    if (full[at] === ')') depth += 1
    else if (full[at] === '(') {
      depth -= 1
      if (depth === 0) {
        return {
          name: full.slice(0, at).trim(),
          localeName: full.slice(at + 1, -1).trim(),
        }
      }
    }
  }
  return { name: full, localeName: '' }
}

/** Qualité portée par le nom, quand seul `say -v ?` est disponible. */
function qualityOf(name) {
  if (/\(premium\)$/i.test(name)) return 'premium'
  if (/\(enhanced\)$/i.test(name)) return 'enhanced'
  if (/siri/i.test(name)) return 'siri'
  return 'compact'
}

/**
 * Trouver une voix par son nom, son nom affiché ou son identifiant.
 * @param {readonly object[]} voices catalogue
 * @param {string} wanted nom demandé
 * @param {string} [locale] langue à privilégier quand le nom existe plusieurs fois
 * @returns {object | null} la voix, ou null si elle n'est pas installée
 */
export function findVoice(voices, wanted, locale) {
  const target = normalize(wanted)
  if (target === '') return null
  const matches = (voices ?? []).filter((voice) => normalize(voice.identifier) === target
    || normalize(voice.name) === target
    || normalize(voice.display) === target
    || normalize(stripQuality(voice.name)) === normalize(stripQuality(target)))
  if (matches.length === 0) return null
  return [...matches].sort((left, right) => score(right, locale) - score(left, locale))[0] ?? null
}

/**
 * Choisir la voix à utiliser.
 *
 * Priorité : la voix demandée, sinon la meilleure qualité installée dans la
 * langue visée, puis l'ordre de préférence. Une voix sans identifiant n'est
 * retenue que si son nom est unique dans le catalogue — un nom ambigu ferait
 * parler la mauvaise langue.
 * @param {readonly object[]} voices catalogue
 * @param {{voice?: string, locale?: string}} options préférences
 * @returns {object | null} voix retenue, ou null (voix par défaut du système)
 */
export function chooseVoice(voices, options = {}) {
  if (!Array.isArray(voices) || voices.length === 0) return null
  const locale = String(options.locale ?? 'fr-CA')
  // Une voix demandée mais absente ne doit pas faire échouer la conversation :
  // on choisit la meilleure disponible et l'appelant le voit dans la réponse.
  const requested = findVoice(voices, options.voice, locale)
  if (requested !== null) return requested
  const sameLocale = voices.filter((voice) => voice.locale.toLowerCase() === locale.toLowerCase())
  const french = sameLocale.length > 0 ? sameLocale : voices.filter((voice) => /^fr\b/i.test(voice.locale))
  const pool = french.length > 0 ? french : voices
  return [...pool].sort((left, right) => score(right, locale) - score(left, locale))[0] ?? null
}

/**
 * Ce qu'il faut passer à `say -v` : l'identifiant exact s'il est connu.
 * @param {{identifier?: string, name: string} | null} voice voix retenue
 * @returns {string | undefined} argument de `-v`
 */
export function voiceArgument(voice) {
  if (voice === null || voice === undefined) return undefined
  return voice.identifier !== undefined && voice.identifier !== '' ? voice.identifier : voice.name
}

function stripQuality(name) {
  return String(name).replace(/\s*\((enhanced|premium|siri)\)\s*$/i, '').trim()
}

function normalize(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase()
}

function score(voice, locale) {
  let points = 0
  if (locale !== undefined && voice.locale.toLowerCase() === String(locale).toLowerCase()) points += 100
  points += voice.quality === 'premium' ? 40 : voice.quality === 'enhanced' ? 30 : voice.quality === 'siri' ? 35 : 0
  if (voice.identifier) points += 20
  const index = PREFERRED.findIndex((name) => normalize(stripQuality(voice.name)) === normalize(stripQuality(name)))
  if (index >= 0) points += 10 - index
  return points
}
