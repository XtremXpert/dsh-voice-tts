/**
 * Synthèse vocale par macOS, et rien d'autre.
 *
 * `say` est la commande Apple qui pilote le moteur de synthèse du système :
 * les mêmes voix que Réglages Système → Contenu énoncé, y compris celles
 * qu'Apple a ajoutées récemment et les variantes Enhanced/Premium une fois
 * téléchargées. `say` sait écrire un WAV directement (`--file-format` /
 * `--data-format`) : plus besoin d'`afconvert` ni de service tiers, et le
 * fichier arrive en 24 kHz mono, ce que le navigateur lit tel quel.
 *
 * Le texte passe par un fichier (`-f`) et non par la ligne de commande :
 * ni limite d'arguments, ni texte interprété comme une option.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { chooseVoice, listVoices, voiceArgument } from './voices.js'

const run = promisify(execFile)

/** Marque d'un conteneur WAV : ce que le navigateur attend. */
const RIFF = Buffer.from('RIFF', 'ascii')

/**
 * Synthétiser un texte avec la voix Apple retenue.
 * @param {string} text texte déjà nettoyé et plafonné
 * @param {object} config section `tts` de la configuration
 * @param {{name: string} | null} [voice] voix déjà résolue ; null = voix du système
 * @returns {Promise<{wav: Buffer, voice: string, sampleRate: number}>}
 */
export async function synthesizeWav(text, config, voice = null) {
  const spoken = String(text ?? '').trim()
  if (spoken === '') throw new Error('texte vide')
  const sampleRate = config.sampleRate ?? 24000
  const folder = await mkdtemp(join(tmpdir(), 'dsh-voice-tts-'))
  const textPath = join(folder, 'phrase.txt')
  const wavPath = join(folder, 'voix.wav')
  try {
    await writeFile(textPath, `${spoken}\n`, 'utf8')
    const args = []
    // L'identifiant AVFoundation, pas le nom : « Flo » existe aussi en allemand.
    const argument = voiceArgument(voice)
    if (argument !== undefined) args.push('-v', argument)
    if (Number.isFinite(config.rate) && config.rate > 0) args.push('-r', String(config.rate))
    args.push(
      '-f', textPath,
      '-o', wavPath,
      '--file-format=WAVE',
      `--data-format=LEI16@${sampleRate}`,
    )
    await run('say', args, { timeout: config.timeoutMs ?? 30000 })
    const wav = await readFile(wavPath)
    if (wav.length < 44 || !wav.subarray(0, 4).equals(RIFF)) {
      throw new Error('say n’a pas produit un WAV')
    }
    return { wav, voice: voice?.name ?? 'défaut', identifier: voice?.identifier ?? null, sampleRate }
  } catch (error) {
    throw new Error(`synthèse macOS impossible (say) : ${messageOf(error)}`)
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Résoudre la voix que le service utilisera par défaut.
 * @param {object} config section `tts`
 * @returns {Promise<{voice: object | null, voices: object[]}>} voix retenue et catalogue
 */
export async function resolveVoice(config) {
  try {
    const voices = await listVoices()
    return { voice: chooseVoice(voices, config), voices }
  } catch {
    // Sans catalogue, `say` prendra la voix du système : la lecture tient.
    return { voice: null, voices: [] }
  }
}

/**
 * Sonde l'état de la synthèse : `say` répond, combien de voix sont installées.
 * @param {object} config section `tts`
 * @param {number} [timeoutMs] délai de la commande
 * @returns {Promise<object>} état lisible par le client et par `curl`
 */
export async function probe(config, timeoutMs = 5000) {
  try {
    const voices = await listVoices({ timeout: timeoutMs, refresh: true })
    const chosen = chooseVoice(voices, config)
    const french = voices.filter((voice) => /^fr\b/i.test(voice.locale))
    return {
      ready: true,
      engine: 'say',
      voices: voices.length,
      french: french.length,
      chosen: chosen === null ? null : { name: chosen.name, locale: chosen.locale, quality: chosen.quality },
      best: french
        .map((voice) => `${voice.name} (${voice.locale}, ${voice.quality})`)
        .slice(0, 24),
    }
  } catch (error) {
    return { ready: false, engine: 'say', error: messageOf(error) }
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
