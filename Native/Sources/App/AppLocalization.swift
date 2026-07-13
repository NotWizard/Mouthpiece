import Foundation

extension UILanguage {
    var localizationIdentifier: String? {
        switch self {
        case .simplifiedChinese: "zh-Hans"
        case .traditionalChinese: "zh-Hant"
        case .english: "en"
        case .system: nil
        }
    }
}

enum AppLocalization {
    static func string(_ key: String, language: UILanguage) -> String {
        guard let identifier = language.localizationIdentifier,
              let path = Bundle.main.path(forResource: identifier, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            return Bundle.main.localizedString(forKey: key, value: nil, table: nil)
        }
        return bundle.localizedString(forKey: key, value: nil, table: nil)
    }
}

extension Notification.Name {
    static let mouthpieceRuntimeSettingsChanged = Notification.Name("MouthpieceRuntimeSettingsChanged")
    static let mouthpieceToggleDictation = Notification.Name("MouthpieceToggleDictation")
}
