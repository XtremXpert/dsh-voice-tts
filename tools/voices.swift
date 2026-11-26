// Liste les voix Apple avec leur identifiant exact et leur qualité.
//
// `say -v ?` affiche des noms nus (« Flo ») qui existent dans plusieurs
// langues : passer ce nom à `say` laisse le système choisir, et sur cette
// machine c'est la voix allemande qui gagne. AVFoundation, lui, expose
// l'identifiant canonique (`com.apple.eloquence.fr-CA.Flo`) que `say` accepte
// tel quel. Le plugin compile ce fichier une fois et garde la liste.
//
// Sortie : une ligne par voix, séparée par des tabulations.
//   identifiant \t nom \t langue \t qualité

import AVFoundation

let labels: [Int: String] = [1: "compact", 2: "enhanced", 3: "premium"]

for voice in AVSpeechSynthesisVoice.speechVoices() {
  let quality = labels[voice.quality.rawValue] ?? "compact"
  let name = voice.name.replacingOccurrences(of: "\t", with: " ")
  print("\(voice.identifier)\t\(name)\t\(voice.language)\t\(quality)")
}
