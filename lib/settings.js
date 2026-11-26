/**
 * Réglages persistés du service de synthèse.
 *
 * Le schéma déclaratif de DSH n'est pas atteignable depuis l'interface de ce
 * profil ; ces réglages vivent donc dans un petit fichier à nous, écrit par la
 * carte de configuration de la fiche du plugin (POST /config) et relu au
 * démarrage. Ordre de priorité : défauts, ce fichier, la rangée du profil,
 * puis l'environnement du Host.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Fichier de réglages, à côté de l'installation Piper. */
export const SETTINGS_PATH = join(homedir(), 'Library', 'Application Support', 'dsh-voice-tts', 'settings.json')

/**
 * Lire les réglages enregistrés.
 * @returns {Promise<object>} objet vide si le fichier manque ou est illisible
 */
export async function readSettings() {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Fusionner et enregistrer des réglages.
 * @param {object} patch champs à changer
 * @returns {Promise<object>} réglages complets après écriture
 */
export async function writeSettings(patch) {
  const current = await readSettings()
  const next = { ...current, ...patch }
  await mkdir(dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}
