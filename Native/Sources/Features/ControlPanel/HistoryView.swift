import AppKit
import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.undoManager) private var undoManager

    @State private var query = ""
    @State private var dateFilter = HistoryDateFilter.all
    @State private var selection: Int64?
    @State private var showingClearConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom) {
                SettingsPageHeader(title: "history.title", subtitle: "history.subtitle")
                Spacer()
                Picker("history.filter", selection: $dateFilter) {
                    ForEach(HistoryDateFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .labelsHidden()
                .frame(width: 140)
                Button("history.clear", role: .destructive) {
                    showingClearConfirmation = true
                }
                .disabled(environment.transcriptions.isEmpty)
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
            .padding(.bottom, 18)

            Divider()

            if filteredRecords.isEmpty {
                HistoryEmptyView(hasSearch: !query.isEmpty || dateFilter != .all)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HSplitView {
                    List(filteredRecords, selection: $selection) { item in
                        HistoryListRow(item: item)
                            .tag(item.id)
                            .contextMenu {
                                Button("common.copy") { copy(item.text) }
                                Button("common.delete", role: .destructive) { delete(item) }
                            }
                    }
                    .listStyle(.sidebar)
                    .scrollContentBackground(.hidden)
                    .frame(minWidth: 260, idealWidth: 300, maxWidth: 340)
                    .background(Color(nsColor: .windowBackgroundColor))

                    Group {
                        if let selectedRecord {
                            HistoryDetailView(
                                item: selectedRecord,
                                onCopy: { copy(selectedRecord.text) },
                                onDelete: { delete(selectedRecord) }
                            )
                        } else {
                            ContentUnavailableView(
                                "history.select.title",
                                systemImage: "clock",
                                description: Text("history.select.body")
                            )
                        }
                    }
                    .frame(minWidth: 380, maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(nsColor: .controlBackgroundColor))
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .searchable(text: $query, placement: .toolbar, prompt: Text("history.search"))
        .confirmationDialog(
            "history.clear.confirmTitle",
            isPresented: $showingClearConfirmation,
            titleVisibility: .visible
        ) {
            Button("history.clear.confirm", role: .destructive) {
                environment.clearHistory()
                selection = nil
            }
            Button("common.cancel", role: .cancel) {}
        } message: {
            Text("history.clear.confirmBody")
        }
        .onAppear {
            environment.refreshHistory()
            selectFirstVisibleRecord()
        }
        .onChange(of: filteredRecords.map(\.id)) { _, _ in
            selectFirstVisibleRecord()
        }
    }

    private var filteredRecords: [TranscriptionRecord] {
        environment.transcriptions.filter {
            HistorySearch.matches($0, query: query, dateFilter: dateFilter)
        }
    }

    private var selectedRecord: TranscriptionRecord? {
        guard let selection else { return nil }
        return filteredRecords.first { $0.id == selection }
    }

    private func selectFirstVisibleRecord() {
        if let selection, filteredRecords.contains(where: { $0.id == selection }) { return }
        selection = filteredRecords.first?.id
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func delete(_ item: TranscriptionRecord) {
        environment.deleteTranscription(item.id)
        undoManager?.registerUndo(withTarget: environment) { target in
            target.restoreTranscription(item)
        }
        undoManager?.setActionName(
            AppLocalization.string(
                "history.delete.action",
                language: environment.settings.uiLanguage
            )
        )
    }
}

private struct HistoryListRow: View {
    let item: TranscriptionRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(item.text)
                .font(.body)
                .lineLimit(2)
            Text(item.timestamp.formatted(date: .abbreviated, time: .shortened))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}

private struct HistoryDetailView: View {
    let item: TranscriptionRecord
    let onCopy: () -> Void
    let onDelete: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(item.timestamp.formatted(date: .long, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(action: onCopy) {
                        Image(systemName: "doc.on.doc")
                    }
                    .help("common.copy")
                    .accessibilityLabel("common.copy")
                    Button(role: .destructive, action: onDelete) {
                        Image(systemName: "trash")
                    }
                    .help("common.delete")
                    .accessibilityLabel("common.delete")
                }

                Text(item.text)
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let rawText = item.rawText, !rawText.isEmpty, rawText != item.text {
                    Divider()
                    DisclosureGroup("history.rawTranscript") {
                        Text(rawText)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 8)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct HistoryEmptyView: View {
    let hasSearch: Bool

    var body: some View {
        ContentUnavailableView(
            hasSearch ? "history.noResults.title" : "history.empty.title",
            systemImage: hasSearch ? "magnifyingglass" : "waveform",
            description: Text(hasSearch ? "history.noResults.body" : "history.empty.body")
        )
    }
}

enum HistoryDateFilter: String, CaseIterable, Identifiable {
    case all
    case today
    case week
    case month

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .all: "history.filter.all"
        case .today: "history.filter.today"
        case .week: "history.filter.week"
        case .month: "history.filter.month"
        }
    }

    func includes(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> Bool {
        switch self {
        case .all:
            true
        case .today:
            calendar.isDate(date, inSameDayAs: now)
        case .week:
            date >= calendar.date(byAdding: .day, value: -7, to: now) ?? .distantPast
        case .month:
            date >= calendar.date(byAdding: .month, value: -1, to: now) ?? .distantPast
        }
    }
}

enum HistorySearch {
    static func matches(
        _ item: TranscriptionRecord,
        query: String,
        dateFilter: HistoryDateFilter,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> Bool {
        guard dateFilter.includes(item.timestamp, now: now, calendar: calendar) else { return false }
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else { return true }
        return item.text.localizedCaseInsensitiveContains(cleanQuery)
            || item.rawText?.localizedCaseInsensitiveContains(cleanQuery) == true
    }
}
