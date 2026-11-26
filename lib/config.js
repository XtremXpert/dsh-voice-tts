/**
 * Configuration du service de synthèse local.
 *
 * Les valeurs par défaut décrivent cette machine : `say`, la commande Apple,
 * avec la meilleure voix française installée. Aucun service tiers, aucune clé.
 * `resolveConfig` normalise la config de la rangée `voice-tts` du profil, puis
 * les variables d'environnement du processus Host, lues à l'activation. Les
 * anciennes variables `DSH_VOICE_CONVERSATION_*` restent lues en repli, pour
 * qu'une installation antérieure continue de fonctionner après le découpage.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Dossier de l'installation Piper de cette machine. */
const PIPER_HOME = join(homedir(), 'Library', 'Application Support', 'dsh-tts-piper')

/** Valeurs par défaut : synthèse neuronale locale, boucle locale seulement. */
export const DEFAULTS = {
  /** Le navigateur parle à ce service : boucle locale seulement. */
  host: '127.0.0.1',
  /** Port du service ; 9033 suit l'ASR (9030) et le TTS du pont (9032). */
  port: 9033,
  tts: {
    /**
     * Moteur de synthèse : `piper` (neuronal local) ou `say` (voix Apple).
     * Piper prend le dessus ; si son binaire ou son modèle manque, la
     * synthèse retombe sur `say` au lieu d'échouer.
     */
    provider: 'piper',
    /** Réglages Piper : binaire, modèle, débit. */
    piper: {
      bin: join(PIPER_HOME, '.venv', 'bin', 'piper'),
      model: join(PIPER_HOME, 'voices', 'fr_FR-siwis-medium.onnx'),
      name: 'Piper siwis',
      lengthScale: 1,
      sentenceSilence: 0.25,
      timeoutMs: 60000,
    },
    /**
     * Voix Apple à utiliser, par son nom (`Flo`, `Thomas (Enhanced)`…).
     * Vide : la meilleure voix installée dans `locale` est choisie — les
     * variantes Enhanced/Premium passent devant les voix compactes.
     */
    voice: '',
    /** Langue visée par le choix automatique. */
    locale: 'fr-CA',
    /** Débit de `say`, en mots par minute (le système tourne vers 175). */
    rate: 185,
    /** Fréquence du WAV renvoyé au navigateur. */
    sampleRate: 24000,
    timeoutMs: 30000,
  },
  /**
   * Longueur maximale du texte prononcé. Une réponse longue est coupée à la
   * dernière phrase complète : le reste demeure à l'écran.
   */
  maxTextChars: 700,
  /** Corps maximal accepté par le service (le texte est borné bien avant). */
  maxBodyBytes: 16384,
}

/**
 * Fusion récursive des surcharges sur les défauts (objets simples seulement).
 * @param {object} base configuration de référence
 * @param {object} override surcharges partielles
 * @returns {object} configuration fusionnée
 */
export function mergeConfig(base, override) {
  if (!isPlainObject(override)) return base
  const merged = { ...base }
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(base[key])
      ? mergeConfig(base[key], value)
      : value
  }
  return merged
}

/**
 * Configuration effective : défauts, rangée du profil, environnement.
 * @param {object} raw config de la rangée `voice-tts`
 * @param {NodeJS.ProcessEnv} env environnement du processus Host
 * @returns {object} configuration prête pour le service
 */
export function resolveConfig(raw = {}, env = process.env) {
  // Copie profonde : sans elle, la normalisation ci-dessous écrirait dans DEFAULTS.
  const config = mergeConfig(structuredClone(DEFAULTS), raw)
  config.port = intOf(env.DSH_VOICE_TTS_PORT ?? env.DSH_VOICE_CONVERSATION_PORT, config.port)
  config.tts.provider = env.DSH_VOICE_TTS_PROVIDER || config.tts.provider
  config.tts.piper.bin = env.DSH_VOICE_TTS_PIPER_BIN || config.tts.piper.bin
  config.tts.piper.model = env.DSH_VOICE_TTS_PIPER_MODEL || config.tts.piper.model
  config.tts.piper.lengthScale = positiveNumber(env.DSH_VOICE_TTS_PIPER_LENGTH_SCALE, config.tts.piper.lengthScale)
  config.tts.voice = env.DSH_VOICE_TTS_VOICE || env.DSH_VOICE_CONVERSATION_VOICE || config.tts.voice
  config.tts.locale = env.DSH_VOICE_TTS_LOCALE || env.DSH_VOICE_CONVERSATION_LOCALE || config.tts.locale
  config.tts.rate = positiveInt(env.DSH_VOICE_TTS_RATE ?? env.DSH_VOICE_CONVERSATION_RATE, config.tts.rate)
  config.maxTextChars = positiveInt(config.maxTextChars, DEFAULTS.maxTextChars)
  config.tts.sampleRate = positiveInt(config.tts.sampleRate, DEFAULTS.tts.sampleRate)
  config.tts.rate = positiveInt(config.tts.rate, DEFAULTS.tts.rate)
  return config
}

/** Adresse de base du service, telle que le navigateur la joint. */
export function serviceUrl(config) {
  const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host
  return `http://${host}:${config.port}`
}

function intOf(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 65535 ? number : fallback
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
