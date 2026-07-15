import AppKit
import SwiftUI

struct VocabularyRulesView: View {
    @EnvironmentObject private var environment: AppEnvironment

    @State private var selection = VocabularySection.terms
    @State private var newPreferredTerm = ""
    @State private var newAvoidedTerm = ""
    @State private var replacementSource = ""
    @State private var replacementTarget = ""

    var body: some View {
        SettingsPage(title: "personalization.title", subtitle: "personalization.subtitle") {
            Picker("", selection: $selection) {
                ForEach(VocabularySection.allCases) { section in
                    Label(section.title, systemImage: section.icon)
                        .tag(section)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 430)

            switch selection {
            case .terms:
                termsContent
            case .replacements:
                replacementsContent
            }
        }
    }

    @ViewBuilder
    private var termsContent: some View {
        SettingsSection(title: "personalization.dictionary") {
            TermInputRow(
                placeholder: "personalization.newTerm",
                value: $newPreferredTerm,
                actionLabel: "personalization.addTerm",
                onAdd: addPreferredTerm
            )
            if environment.dictionaryWords.isEmpty {
                EmptySettingsRow(text: "personalization.preferredEmpty", icon: "textformat")
            } else {
                ForEach(Array(environment.dictionaryWords.enumerated()), id: \.element) { index, term in
                    EditableTermRow(
                        icon: "textformat",
                        term: term,
                        showsDivider: index < environment.dictionaryWords.count - 1,
                        onSave: { savePreferredTerm(term, as: $0) },
                        onDelete: { deletePreferredTerm(term) }
                    )
                }
            }
        }

        SettingsSection(title: "personalization.avoidedTerms") {
            TermInputRow(
                placeholder: "personalization.newAvoidedTerm",
                value: $newAvoidedTerm,
                actionLabel: "personalization.addAvoidedTerm",
                onAdd: addAvoidedTerm
            )
            let avoided = environment.settings.terminologyProfile.avoidedTerms
            if avoided.isEmpty {
                EmptySettingsRow(text: "personalization.avoidedEmpty", icon: "nosign")
            } else {
                ForEach(Array(avoided.enumerated()), id: \.element) { index, term in
                    EditableTermRow(
                        icon: "nosign",
                        term: term,
                        showsDivider: index < avoided.count - 1,
                        onSave: { saveAvoidedTerm(term, as: $0) },
                        onDelete: { deleteAvoidedTerm(term) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var replacementsContent: some View {
        SettingsSection(title: "personalization.replacements") {
            HStack(spacing: 8) {
                TextField("personalization.replacementSource", text: $replacementSource)
                Image(systemName: "arrow.right")
                    .foregroundStyle(.secondary)
                TextField("personalization.replacementTarget", text: $replacementTarget)
                Button(action: addReplacement) {
                    Image(systemName: "plus")
                }
                .help("personalization.addReplacement")
                .accessibilityLabel("personalization.addReplacement")
            }
            .padding(12)
            .overlay(alignment: .bottom) {
                Divider().padding(.leading, 44)
            }

            let rules = environment.settings.terminologyProfile.replacementRules
            if rules.isEmpty {
                EmptySettingsRow(text: "personalization.replacementsEmpty", icon: "arrow.left.arrow.right")
            } else {
                ForEach(Array(rules.keys.sorted().enumerated()), id: \.element) { index, source in
                    ReplacementRuleRow(
                        source: source,
                        target: rules[source] ?? "",
                        showsDivider: index < rules.count - 1,
                        onSave: { saveReplacement(source, newSource: $0, newTarget: $1) },
                        onDelete: { deleteReplacement(source) }
                    )
                }
            }
        }
    }

    private func addPreferredTerm() {
        let clean = newPreferredTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isUnique(clean, in: environment.dictionaryWords) else {
            NSSound.beep()
            return
        }
        environment.saveDictionary(environment.dictionaryWords + [clean])
        newPreferredTerm = ""
    }

    private func savePreferredTerm(_ old: String, as new: String) -> Bool {
        let clean = new.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isUnique(clean, in: environment.dictionaryWords, excluding: old) else { return false }
        environment.saveDictionary(environment.dictionaryWords.map { $0 == old ? clean : $0 })
        return true
    }

    private func deletePreferredTerm(_ term: String) {
        environment.saveDictionary(environment.dictionaryWords.filter { $0 != term })
    }

    private func addAvoidedTerm() {
        let clean = newAvoidedTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        let terms = environment.settings.terminologyProfile.avoidedTerms
        guard isUnique(clean, in: terms) else {
            NSSound.beep()
            return
        }
        updateTerminology { $0.avoidedTerms.append(clean) }
        newAvoidedTerm = ""
    }

    private func saveAvoidedTerm(_ old: String, as new: String) -> Bool {
        let clean = new.trimmingCharacters(in: .whitespacesAndNewlines)
        let terms = environment.settings.terminologyProfile.avoidedTerms
        guard isUnique(clean, in: terms, excluding: old) else { return false }
        updateTerminology { profile in
            profile.avoidedTerms = profile.avoidedTerms.map { $0 == old ? clean : $0 }
        }
        return true
    }

    private func deleteAvoidedTerm(_ term: String) {
        updateTerminology { $0.avoidedTerms.removeAll { $0 == term } }
    }

    private func addReplacement() {
        let source = replacementSource.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = replacementTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty, !target.isEmpty, source != target,
              environment.settings.terminologyProfile.replacementRules[source] == nil else {
            NSSound.beep()
            return
        }
        updateTerminology { $0.replacementRules[source] = target }
        replacementSource = ""
        replacementTarget = ""
    }

    private func saveReplacement(_ oldSource: String, newSource: String, newTarget: String) -> Bool {
        let source = newSource.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = newTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        let rules = environment.settings.terminologyProfile.replacementRules
        guard !source.isEmpty, !target.isEmpty, source != target,
              source == oldSource || rules[source] == nil else { return false }
        updateTerminology { profile in
            profile.replacementRules.removeValue(forKey: oldSource)
            profile.replacementRules[source] = target
        }
        return true
    }

    private func deleteReplacement(_ source: String) {
        updateTerminology { $0.replacementRules.removeValue(forKey: source) }
    }

    private func updateTerminology(_ mutation: (inout TerminologyProfile) -> Void) {
        var settings = environment.settings
        mutation(&settings.terminologyProfile)
        settings.terminologyProfile.normalize()
        environment.saveSettings(settings)
    }

    private func isUnique(_ value: String, in values: [String], excluding: String? = nil) -> Bool {
        guard !value.isEmpty else { return false }
        return !values.contains {
            $0 != excluding && $0.caseInsensitiveCompare(value) == .orderedSame
        }
    }
}

private enum VocabularySection: String, CaseIterable, Identifiable {
    case terms
    case replacements

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .terms: "personalization.terms"
        case .replacements: "personalization.replacementsTab"
        }
    }

    var icon: String {
        switch self {
        case .terms: "textformat"
        case .replacements: "arrow.left.arrow.right"
        }
    }
}

private struct TermInputRow: View {
    let placeholder: LocalizedStringKey
    @Binding var value: String
    let actionLabel: LocalizedStringKey
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField(placeholder, text: $value)
                .onSubmit(onAdd)
            Button(action: onAdd) {
                Image(systemName: "plus")
            }
            .help(actionLabel)
            .accessibilityLabel(actionLabel)
            .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(12)
        .overlay(alignment: .bottom) {
            Divider().padding(.leading, 44)
        }
    }
}

private struct EmptySettingsRow: View {
    let text: LocalizedStringKey
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.tertiary)
                .frame(width: 20)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 13)
        .frame(minHeight: 44)
    }
}

private struct EditableTermRow: View {
    let icon: String
    let term: String
    let showsDivider: Bool
    let onSave: (String) -> Bool
    let onDelete: () -> Void

    @State private var draft: String
    @State private var isEditing = false

    init(
        icon: String,
        term: String,
        showsDivider: Bool,
        onSave: @escaping (String) -> Bool,
        onDelete: @escaping () -> Void
    ) {
        self.icon = icon
        self.term = term
        self.showsDivider = showsDivider
        self.onSave = onSave
        self.onDelete = onDelete
        _draft = State(initialValue: term)
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 20)
            if isEditing {
                TextField("", text: $draft)
                    .onSubmit(commit)
            } else {
                Text(verbatim: term)
                    .textSelection(.enabled)
            }
            Spacer()
            Button {
                if isEditing { commit() } else { isEditing = true }
            } label: {
                Image(systemName: isEditing ? "checkmark" : "pencil")
            }
            .buttonStyle(.plain)
            .help(isEditing ? "common.done" : "common.edit")
            Button(action: onDelete) {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
            .help("common.delete")
        }
        .padding(.horizontal, 13)
        .frame(minHeight: 44)
        .overlay(alignment: .bottom) {
            if showsDivider { Divider().padding(.leading, 44) }
        }
        .onChange(of: term) { _, value in draft = value }
    }

    private func commit() {
        if onSave(draft) {
            isEditing = false
        } else {
            NSSound.beep()
        }
    }
}

private struct ReplacementRuleRow: View {
    let source: String
    let target: String
    let showsDivider: Bool
    let onSave: (String, String) -> Bool
    let onDelete: () -> Void

    @State private var sourceDraft: String
    @State private var targetDraft: String
    @State private var isEditing = false

    init(
        source: String,
        target: String,
        showsDivider: Bool,
        onSave: @escaping (String, String) -> Bool,
        onDelete: @escaping () -> Void
    ) {
        self.source = source
        self.target = target
        self.showsDivider = showsDivider
        self.onSave = onSave
        self.onDelete = onDelete
        _sourceDraft = State(initialValue: source)
        _targetDraft = State(initialValue: target)
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.left.arrow.right")
                .foregroundStyle(.secondary)
                .frame(width: 20)
            if isEditing {
                TextField("personalization.replacementSource", text: $sourceDraft)
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                TextField("personalization.replacementTarget", text: $targetDraft)
            } else {
                Text(verbatim: source)
                Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                Text(verbatim: target).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                if isEditing { commit() } else { isEditing = true }
            } label: {
                Image(systemName: isEditing ? "checkmark" : "pencil")
            }
            .buttonStyle(.plain)
            .help(isEditing ? "common.done" : "common.edit")
            Button(action: onDelete) {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
            .help("common.delete")
        }
        .padding(.horizontal, 13)
        .frame(minHeight: 44)
        .overlay(alignment: .bottom) {
            if showsDivider { Divider().padding(.leading, 44) }
        }
    }

    private func commit() {
        if onSave(sourceDraft, targetDraft) {
            isEditing = false
        } else {
            NSSound.beep()
        }
    }
}

struct PromptStudioSheet: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.dismiss) private var dismiss

    @State private var tab = PromptStudioTab.edit
    @State private var draft = ""
    @State private var testInput = ""
    @State private var testResult = ""
    @State private var isTesting = false
    @State private var showingDiscardConfirmation = false

    private var savedPrompt: String {
        environment.settings.customPrompt.isEmpty
            ? ReasoningService.defaultCleanupPrompt
            : environment.settings.customPrompt
    }

    private var isDirty: Bool { draft != savedPrompt }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("promptStudio.title")
                        .font(.title2.weight(.semibold))
                    Text("promptStudio.subtitle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Picker("", selection: $tab) {
                    Label("promptStudio.current", systemImage: "eye").tag(PromptStudioTab.current)
                    Label("promptStudio.edit", systemImage: "pencil").tag(PromptStudioTab.edit)
                    Label("promptStudio.test", systemImage: "testtube.2").tag(PromptStudioTab.test)
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                content
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            HStack {
                Button("common.cancel") {
                    if isDirty {
                        showingDiscardConfirmation = true
                    } else {
                        dismiss()
                    }
                }
                Spacer()
                Button("promptStudio.reset") {
                    draft = ReasoningService.defaultCleanupPrompt
                }
                Button("common.save") {
                    var settings = environment.settings
                    settings.customPrompt = draft == ReasoningService.defaultCleanupPrompt ? "" : draft
                    environment.saveSettings(settings)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isDirty)
            }
            .padding(16)
        }
        .frame(width: 720, height: 570)
        .interactiveDismissDisabled(isDirty)
        .confirmationDialog(
            "promptStudio.discard.title",
            isPresented: $showingDiscardConfirmation,
            titleVisibility: .visible
        ) {
            Button("promptStudio.discard", role: .destructive) { dismiss() }
            Button("common.cancel", role: .cancel) {}
        }
        .onAppear {
            draft = savedPrompt
            if testInput.isEmpty {
                testInput = AppLocalization.string(
                    "promptStudio.defaultInput",
                    language: environment.settings.uiLanguage
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .current:
            ScrollView {
                Text(ReasoningService.systemPrompt(settings: environment.settings))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        case .edit:
            TextEditor(text: $draft)
                .font(.system(.caption, design: .monospaced))
                .padding(8)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
                }
        case .test:
            VStack(alignment: .leading, spacing: 12) {
                TextEditor(text: $testInput)
                    .frame(minHeight: 100)
                    .padding(8)
                    .background(Color(nsColor: .textBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                HStack {
                    Button("promptStudio.runTest") {
                        isTesting = true
                        testResult = ""
                        Task {
                            do {
                                testResult = try await environment.testPrompt(draft, input: testInput)
                            } catch {
                                testResult = error.localizedDescription
                            }
                            isTesting = false
                        }
                    }
                    .disabled(isTesting || testInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if isTesting { ProgressView().controlSize(.small) }
                }
                if !testResult.isEmpty {
                    ScrollView {
                        Text(testResult)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

private enum PromptStudioTab: String, CaseIterable {
    case current
    case edit
    case test
}
