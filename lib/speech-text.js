/**
 * Préparer un texte écrit pour la bouche d'une synthèse.
 *
 * Une réponse d'agent est du Markdown : titres, listes, blocs de code, liens,
 * emphases. Rien de cela ne se prononce. `toSpoken` retire ce qui ne se dit
 * pas, `limitSpoken` coupe à une frontière de phrase pour qu'une réponse
 * longue s'arrête proprement au lieu d'être tronquée au milieu d'un mot.
 */

/** Position après le dernier point final de `window` (0 si aucune phrase entière). */
function lastSentenceEnd(window) {
  const matches = window.match(/[.!?…]["»)\]]?(?=\s|$)/g)
  if (matches === null) return 0
  const last = matches[matches.length - 1]
  const at = window.lastIndexOf(last)
  return at < 0 ? 0 : at + last.length
}

/**
 * Nettoyage pour l'oral : blocs de code, tableaux, balisage, liens et URL.
 * @param {string} text texte Markdown de l'agent
 * @returns {string} texte prononçable, espaces normalisés
 */
export function toSpoken(text) {
  if (typeof text !== 'string' || text === '') return ''
  const stripped = text
    // Un bloc de code ne se lit pas : on le remplace par une respiration.
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    // Code en ligne et emphases : le contenu reste, les marques partent.
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    // Images et liens : l'ancre se dit, la cible non.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // URL nues.
    .replace(/https?:\/\/\S+/g, ' ')

  // Ligne à ligne : titres, puces, citations, règles, séparateurs de tableau.
  const lines = []
  for (const line of stripped.split('\n')) {
    const trimmed = line.trim()
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(trimmed)) continue // |---|---|
    let cleaned = trimmed
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^(-{3,}|\*{3,})$/, '')
      .replace(/\s*\|\s*/g, ', ')
    cleaned = cleaned.trim()
    if (cleaned !== '') lines.push(cleaned)
  }

  return lines.join(' ')
    .replace(/\s+/g, ' ')
    // Ponctuation doublée par les remplacements ; l'espace avant « : » et « ; »
    // est la typographie française, on le garde.
    .replace(/\s+([.,])/g, '$1')
    .replace(/([,;:])\1+/g, '$1')
    .replace(/[,;:]+$/, '')
    .trim()
}

/**
 * Couper un texte prononçable à `max` caractères, de préférence en fin de phrase.
 * @param {string} text texte déjà nettoyé
 * @param {number} max plafond demandé
 * @returns {{text: string, truncated: boolean}} texte à dire et drapeau de coupe
 */
export function limitSpoken(text, max) {
  const limit = Number.isInteger(max) && max > 0 ? max : 700
  if (text.length <= limit) return { text, truncated: false }
  const window = text.slice(0, limit)
  const sentence = lastSentenceEnd(window)
  if (sentence > limit * 0.4) return { text: window.slice(0, sentence).trim(), truncated: true }
  const space = window.lastIndexOf(' ')
  const cut = space > 0 ? window.slice(0, space) : window
  return { text: `${cut.replace(/[\s,;:]+$/, '')}…`, truncated: true }
}

/**
 * Découper pour la synthèse : Kokoro et `say` respirent mieux par phrases.
 * @param {string} text texte prononçable
 * @param {number} maxChars longueur visée d'un morceau
 * @returns {readonly string[]} morceaux non vides, dans l'ordre
 */
export function splitSpoken(text, maxChars = 240) {
  const pieces = []
  let rest = text.trim()
  while (rest !== '') {
    if (rest.length <= maxChars) { pieces.push(rest); break }
    const window = rest.slice(0, maxChars)
    const sentence = lastSentenceEnd(window)
    const at = sentence > maxChars * 0.4 ? sentence : Math.max(1, window.lastIndexOf(' '))
    pieces.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  return pieces.filter((piece) => piece !== '')
}
