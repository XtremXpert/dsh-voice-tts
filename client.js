/**
 * `dsh-voice-tts` — moitié navigateur.
 *
 * Le schéma de configuration déclaratif de DSH n'est pas atteignable dans ce
 * profil : la carte ci-dessous le remplace, dans la fiche du bundle. Elle
 * interroge le service de synthèse (`/config`) et y écrit le moteur et la voix,
 * qui sont persistés côté Host.
 *
 * Aucune clé, aucun secret : seulement deux choix qui changent une voix.
 */

window.__ModuleLoader__.load({
  id: 'dsh-voice-tts',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Espace de noms des libellés. */
    const NS = 'voiceTts'

    /** Service de synthèse, ouvert par la moitié Host de ce même bundle. */
    const SERVICE_URL = 'http://127.0.0.1:9033'

    const FR = {
      'title': 'Synthèse vocale',
      'engine': 'Moteur',
      'piper': 'Piper (neuronal, local)',
      'say': 'Voix Apple',
      'voice': 'Voix Apple',
      'voiceHint': 'vide = la meilleure installée (Amélie Premium, Chantal…)',
      'save': 'Enregistrer',
      'saved': 'Enregistré.',
      'failed': 'Le service de synthèse ne répond pas.',
    }

    const EN = {
      'title': 'Speech synthesis',
      'engine': 'Engine',
      'piper': 'Piper (neural, local)',
      'say': 'Apple voices',
      'voice': 'Apple voice',
      'voiceHint': 'empty = the best installed one',
      'save': 'Save',
      'saved': 'Saved.',
      'failed': 'The speech service is not answering.',
    }

    const label = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', margin: '4px 0' }
    const field = { font: 'inherit', fontSize: '13px', padding: '2px 6px', borderRadius: '6px' }

    function ConfigCard() {
      const [state, setState] = React.useState({ provider: null, voice: '', status: '' })

      React.useEffect(() => {
        let alive = true
        fetch(`${SERVICE_URL}/config`)
          .then((response) => response.json())
          .then((body) => { if (alive) setState({ provider: body.provider, voice: body.voice ?? '', status: '' }) })
          .catch(() => { if (alive) setState((current) => ({ ...current, status: 'failed' })) })
        return () => { alive = false }
      }, [])

      const save = () => {
        fetch(`${SERVICE_URL}/config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: state.provider, voice: state.voice }),
        })
          .then((response) => {
            if (!response.ok) throw new Error(String(response.status))
            setState((current) => ({ ...current, status: 'saved' }))
          })
          .catch(() => { setState((current) => ({ ...current, status: 'failed' })) })
      }

      const text = (key) => (FALLBACK[key] ?? key)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('label', { style: label },
          h('span', { style: { minWidth: '7em' } }, text('engine')),
          h('select', {
            style: field,
            value: state.provider ?? 'piper',
            onChange: (event) => { setState((current) => ({ ...current, provider: event.target.value, status: '' })) },
          },
          h('option', { value: 'piper' }, text('piper')),
          h('option', { value: 'say' }, text('say')))),
        h('label', { style: label },
          h('span', { style: { minWidth: '7em' } }, text('voice')),
          h('input', {
            style: { ...field, minWidth: '12em' },
            value: state.voice,
            placeholder: text('voiceHint'),
            onChange: (event) => { setState((current) => ({ ...current, voice: event.target.value, status: '' })) },
          })),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('button', {
            type: 'button',
            onClick: save,
            style: { fontSize: '12px', padding: '2px 10px', borderRadius: '6px', cursor: 'pointer' },
          }, text('save')),
          state.status !== '' && h('span', {
            style: {
              fontSize: '12px',
              color: state.status === 'failed' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
            },
          }, text(state.status))))
    }

    /** Repli des libellés : la clé manquante s'affiche telle quelle. */
    const FALLBACK = FR

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'fr', FR), 'voice-tts: libellés fr')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'voice-tts: libellés en')
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-voice-tts',
          locale: NS,
          inject: () => ({}),
        }, ConfigCard))
      },
    }
  },
})
