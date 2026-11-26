/**
 * Synthèse neuronale locale par Piper.
 *
 * Piper est un moteur VITS qui tourne sur le processeur, sans réseau et sans
 * clé : le modèle (`*.onnx`) est un fichier de quelques dizaines de mégaoctets
 * qui vit sur cette machine. C'est ce qui remplace `say` quand la qualité des
 * voix Apple ne suffit pas.
 *
 * Le texte passe par l'entrée standard, jamais par la ligne de commande : ni
 * limite d'arguments, ni texte interprété comme une option.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Marque d'un conteneur WAV. */
const RIFF = Buffer.from('RIFF', 'ascii')

/**
 * Synthétiser un texte avec un modèle Piper.
 * @param {string} text texte déjà nettoyé et plafonné
 * @param {object} config section `tts.piper` de la configuration
 * @returns {Promise<{wav: Buffer, voice: string, sampleRate: number}>}
 */
export async function synthesizeWithPiper(text, config) {
  const spoken = String(text ?? '').trim()
  if (spoken === '') throw new Error('texte vide')
  if (typeof config?.model !== 'string' || config.model === '') {
    throw new Error('modèle Piper non configuré')
  }
  const folder = await mkdtemp(join(tmpdir(), 'dsh-voice-tts-piper-'))
  const wavPath = join(folder, 'voix.wav')
  try {
    const args = ['-m', config.model, '-f', wavPath]
    if (Number.isFinite(config.lengthScale) && config.lengthScale > 0) {
      args.push('--length-scale', String(config.lengthScale))
    }
    if (Number.isFinite(config.sentenceSilence) && config.sentenceSilence >= 0) {
      args.push('--sentence-silence', String(config.sentenceSilence))
    }
    await pipe(config.bin ?? 'piper', args, `${spoken}\n`, config.timeoutMs ?? 60000)
    const wav = await readFile(wavPath)
    if (wav.length < 44 || !wav.subarray(0, 4).equals(RIFF)) {
      throw new Error('Piper n’a pas produit un WAV')
    }
    return { wav, voice: config.name ?? 'Piper', sampleRate: config.sampleRate ?? null }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/** Lancer un processus, lui écrire `input` sur stdin, et attendre sa fin. */
function pipe(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Piper n’a pas répondu en ${timeoutMs} ms`))
    }, timeoutMs)
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Piper a quitté avec le code ${code}${stderr ? ` : ${stderr.trim().slice(0, 200)}` : ''}`))
    })
    child.stdin.end(input)
  })
}
