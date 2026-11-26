/**
 * `dsh-voice-tts` — la synthèse vocale locale de DSH.
 *
 * La page Web ne peut pas lancer `say` : ce plugin tient donc un petit service
 * HTTP sur la boucle locale qui prononce le texte demandé et renvoie un WAV.
 * Il ne connaît rien de la conversation : n'importe quel client de la page —
 * le mode conversation aujourd'hui, un bouton « lire cette réponse » demain —
 * lui parle par le même contrat.
 *
 * Rien ne sort de la machine, aucune clé n'est lue.
 */

import Schema from '@deepseek-ai/schemastery'

import { DEFAULTS, resolveConfig } from './lib/config.js'
import { createSpeechService } from './lib/server.js'
import { readSettings } from './lib/settings.js'

/** Nom du plugin. */
export const name = 'dsh-voice-tts'

/**
 * Réglages exposés dans la fiche du plugin : moteur, voix, débit, plafond.
 * Les valeurs par défaut viennent de `lib/config.js`, seule source de vérité.
 */
export const Config = Schema.object({
  tts: Schema.object({
    provider: Schema.union(['piper', 'say'])
      .default(DEFAULTS.tts.provider)
      .description('Moteur : Piper (neuronal local) ou les voix Apple'),
    voice: Schema.string()
      .default(DEFAULTS.tts.voice)
      .description('Voix Apple ; vide = la meilleure installée, Premium d’abord'),
    locale: Schema.string()
      .default(DEFAULTS.tts.locale)
      .description('Langue visée par le choix automatique de la voix'),
    rate: Schema.natural()
      .default(DEFAULTS.tts.rate)
      .min(80)
      .max(400)
      .description('Débit des voix Apple, en mots par minute'),
    piper: Schema.object({
      model: Schema.string()
        .default(DEFAULTS.tts.piper.model)
        .description('Modèle Piper : nom sous voices/, ou chemin absolu du .onnx'),
      lengthScale: Schema.number()
        .default(DEFAULTS.tts.piper.lengthScale)
        .min(0.5)
        .max(2)
        .description('Débit Piper ; au-dessus de 1, plus lent'),
    }),
  }).description('Synthèse'),
  maxTextChars: Schema.natural()
    .default(DEFAULTS.maxTextChars)
    .min(80)
    .max(4000)
    .description('Longueur maximale prononcée ; le reste demeure à l’écran'),
})

/**
 * Démarre le service de synthèse avec la vie du Host.
 * @param {object} ctx contexte du Host
 * @param {object} rawConfig config de la rangée `voice-tts`
 */
export async function apply(ctx, rawConfig = {}) {
  // Les réglages de la carte du plugin priment sur les défauts et sont relus
  // à chaque démarrage.
  const stored = await readSettings()
  const config = resolveConfig(rawConfig, process.env, stored)
  const logger = ctx.logger
  const service = createSpeechService({ config, logger })

  ctx.effect(() => {
    service.start()
      .then((url) => logger?.info?.(`voice-tts: synthèse locale sur ${url} (${config.tts.provider})`))
      .catch((error) => logger?.warn?.(`voice-tts: service non démarré — ${messageOf(error)}`))
    return () => { void service.stop() }
  }, 'voice-tts: service de synthèse')
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
