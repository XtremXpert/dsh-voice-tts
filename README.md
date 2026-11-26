# dsh-voice-tts

La **synthèse vocale locale** de DeepSeek Harness : un service HTTP qui fait
parler macOS et renvoie un WAV à la page Web.

La page ne peut pas lancer `say` elle-même. Ce plugin tient donc un service sur
la boucle locale, et c'est tout : il ne connaît ni le micro, ni la conversation,
ni l'agent. N'importe quel client de la page lui parle par le même contrat —
le mode conversation aujourd'hui, un bouton « lire cette réponse » demain.

## Contrat

```sh
curl -s http://127.0.0.1:9033/status
# {"ready":true,"service":"dsh-voice-tts","engine":"say","voice":"Flo",
#  "voiceLocale":"fr-CA","rate":185,"maxTextChars":700,"busy":false,"lastError":null}

curl -s -X POST -H 'content-type: application/json' \
     -d '{"text":"Bonjour, ceci est un essai."}' \
     http://127.0.0.1:9033/synthesize -o essai.wav
# corps : audio/wav ; en-têtes x-voice-name, x-voice-locale, x-spoken-chars, x-truncated
```

| Route | Rôle |
|---|---|
| `GET /` ou `/status` | état, voix choisie, débit, dernier échec |
| `GET /voices` | voix Apple installées, celles en français en tête |
| `GET /health` | sonde `say` (binaire présent, voix résolue) |
| `POST /synthesize` | `{"text": "…"}` → WAV ; `?voice=Nom` pour forcer une voix |

Une synthèse à la fois : `say` sature vite, et le client n'attend qu'une
réponse. Les erreurs de demande (voix inconnue, texte vide) répondent 400, les
échecs de synthèse 502, avec `{"error": "…"}`.

## Installation

```sh
./gh-app.sh api repos/XtremXpert/dsh-voice-tts   # une fois publié
dsh plugin --profile web add dsh-voice-tts
```

Dans l'application : `plugin_manager` → `install_bundle` avec le chemin absolu
du dépôt, puis redémarrer le client (le service est côté Host).

## Moteurs de synthèse

Deux moteurs, choisis par `tts.provider` :

| Moteur | Qualité | Réseau | Réglé par |
|---|---|---|---|
| `piper` (défaut) | neuronale, locale, naturelle | aucun | `tts.piper` |
| `say` | voix Apple installées (compact/Enhanced/Premium) | aucun | `tts.voice`, `tts.rate` |

`piper` l'emporte quand il est configuré ; s'il manque, la synthèse **retombe
sur `say`** au lieu d'échouer — une panne de modèle ne doit pas priver la page
de voix. Le journal du Host dit lequel a répondu, et l'en-tête
`x-voice-source` le répète au client.

Piper vit dans `~/Library/Application Support/dsh-tts-piper` : un venv
(`piper-tts`) et des modèles ONNX dans `voices/`. Voix françaises disponibles
en amont : `fr_FR-siwis-medium` (femme, défaut), `fr_FR-tom-medium` (homme),
`fr_FR-upmc-medium` (deux voix), `fr_FR-mls-medium`. Changer de voix = changer
`model`, rien d'autre.

## Réglage

Défauts dans `lib/config.js`, surchargés par la rangée `voice-tts` du profil,
puis par l'environnement du processus Host :

| Variable | Défaut | Rôle |
|---|---|---|
| `DSH_VOICE_TTS_PORT` | `9033` | port d'écoute, boucle locale seulement |
| `DSH_VOICE_TTS_PROVIDER` | `piper` | `piper` ou `say` |
| `DSH_VOICE_TTS_PIPER_BIN` | venv local | binaire `piper` |
| `DSH_VOICE_TTS_PIPER_MODEL` | `fr_FR-siwis-medium.onnx` | modèle ONNX |
| `DSH_VOICE_TTS_PIPER_LENGTH_SCALE` | `1` | débit (>1 = plus lent) |
| `DSH_VOICE_TTS_VOICE` | *(vide)* | nom de voix Apple ; vide = meilleure voix de `locale` |
| `DSH_VOICE_TTS_LOCALE` | `fr-CA` | langue visée par le choix automatique |
| `DSH_VOICE_TTS_RATE` | `185` | débit `say`, mots par minute |

Les anciennes variables `DSH_VOICE_CONVERSATION_*` restent lues en repli : une
installation antérieure continue de fonctionner après le découpage.

Le catalogue de voix passe par AVFoundation (`tools/voices.swift`, compilé une
fois et mis en cache) : `say -v ?` n'expose que des noms nus, ambigus entre
langues, alors que l'identifiant canonique (`com.apple.eloquence.fr-CA.Flo`)
est celui que `say` accepte sans se tromper.

## Vérification

```sh
npm test                                      # unités : config, voix, service, HTTP
curl -s http://127.0.0.1:9033/status
curl -s -X POST -H 'content-type: application/json' \
     -d '{"text":"Essai."}' http://127.0.0.1:9033/synthesize -o /tmp/e.wav && afplay /tmp/e.wav
```

## Confidentialité

Tout reste sur la machine : `say` est une commande Apple, le service n'écoute
que `127.0.0.1`, aucune clé n'est lue, et le CORS n'autorise que ce qui est
nécessaire — la page peut demander un WAV, rien de plus.

## Licence

MIT, comme le harnais.
