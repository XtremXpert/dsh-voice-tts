import assert from 'node:assert/strict'
import test from 'node:test'

import { limitSpoken, splitSpoken, toSpoken } from '../lib/speech-text.js'

test('toSpoken retire ce qui ne se prononce pas', () => {
  const answer = [
    '## Résultat',
    '',
    'Le déploiement est **prêt** : voir [le journal](https://exemple.test/j).',
    '',
    '```yaml',
    'replicas: 3',
    '```',
    '',
    '- première ligne',
    '- deuxième ligne',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n')
  const spoken = toSpoken(answer)
  assert.doesNotMatch(spoken, /replicas/, 'le bloc de code ne se dit pas')
  assert.doesNotMatch(spoken, /\*\*|\]\(|https?:/, 'le balisage et les URL partent')
  assert.match(spoken, /Résultat/)
  assert.match(spoken, /Le déploiement est prêt : voir le journal\./)
  assert.match(spoken, /première ligne/)
  assert.match(spoken, /1, 2/, 'une ligne de tableau se dit à plat')
})

test('toSpoken laisse un texte simple intact', () => {
  assert.equal(toSpoken('Bonjour, je vous écoute.'), 'Bonjour, je vous écoute.')
  assert.equal(toSpoken(''), '')
  assert.equal(toSpoken(undefined), '')
})

test('limitSpoken ne coupe pas un texte court', () => {
  const result = limitSpoken('Bonjour.', 700)
  assert.equal(result.truncated, false)
  assert.equal(result.text, 'Bonjour.')
})

test('limitSpoken coupe en fin de phrase', () => {
  const text = `${'Première phrase. '.repeat(20)}Dernière phrase.`
  const result = limitSpoken(text, 100)
  assert.equal(result.truncated, true)
  assert.ok(result.text.length <= 100)
  assert.match(result.text, /\.$/, 'la coupe tombe sur un point')
})

test('limitSpoken retombe sur un mot et signale la coupe', () => {
  const text = 'mot '.repeat(200)
  const result = limitSpoken(text, 40)
  assert.equal(result.truncated, true)
  assert.ok(result.text.length <= 41)
  assert.match(result.text, /…$/)
  assert.doesNotMatch(result.text, /mo…$/, 'pas de mot tranché')
})

test('splitSpoken découpe par phrases sans perdre de texte', () => {
  const text = 'Une. Deux. Trois. Quatre.'
  const pieces = splitSpoken(text, 10)
  assert.ok(pieces.length > 1)
  assert.equal(pieces.join(' '), text)
  assert.ok(pieces.every((piece) => piece.trim() !== ''))
})
