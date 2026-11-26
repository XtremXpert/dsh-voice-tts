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

import { resolveConfig } from './lib/config.js'
import { createSpeechService } from './lib/server.js'

/** Nom du plugin. */
export const name = 'dsh-voice-tts'

/**
 * Démarre le service de synthèse avec la vie du Host.
 * @param {object} ctx contexte du Host
 * @param {object} rawConfig config de la rangée `voice-tts`
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger
  const service = createSpeechService({ config, logger })

  ctx.effect(() => {
    service.start()
      .then((url) => logger?.info?.(`voice-tts: synthèse locale sur ${url}`))
      .catch((error) => logger?.warn?.(`voice-tts: service non démarré — ${messageOf(error)}`))
    return () => { void service.stop() }
  }, 'voice-tts: service de synthèse')
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
