// ReaderScreen.swift — the article, kept, and readable after the link is dead.
//
// The text was saved when the thing was shelved (`canonical.article`, built by
// api/article.js), so this screen makes NO network call. White paper and ink,
// not the shelf's colour: six minutes of reading on poster red is a headache,
// and the shelf is still named by the chip.
//
// Paper: file "shelf" → "Reader — light" / "Reader — dark".
import SwiftUI

struct Article: Sendable {
    var byline: String?
    var siteName: String?
    var text: String
    var readingMinutes: Int?
    var summary: String?

    /// The saved article on an item, or nil. One place decides what "has one" means.
    init?(_ item: Item) {
        guard let a = item.canonical["article"]?.object,
              let text = a["text"]?.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        self.text = text
        byline = a["byline"]?.string
        siteName = a["siteName"]?.string
        readingMinutes = a["readingMinutes"]?.number.map { Int($0) }
        summary = a["summary"]?.string
    }

    var paragraphs: [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

struct ReaderScreen: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    let item: Item
    var onClose: () -> Void

    private var savedOn: String? {
        guard let d = ISO8601DateFormatter.lenient(item.createdAt) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "d MMM yyyy"
        return f.string(from: d)
    }

    var body: some View {
        let article = Article(item)
        VStack(spacing: 0) {
            HStack(spacing: Tokens.Space.md) {
                HStack(spacing: Tokens.Space.sm) {
                    ShelfBlock(list: item.list, width: Tokens.Space.xl + Tokens.Space.xs)
                        .frame(height: Tokens.Space.xl + Tokens.Space.xs)
                    if let site = article?.siteName { Micro(site, color: theme.inkSoft).lineLimit(1) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                TextAction(title: "Close", action: onClose)
            }
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.sm)
            .padding(.bottom, Tokens.Space.md)
            Rule()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.title ?? "Saved article").style(T.title).fontWeight(.bold).foregroundStyle(theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    let meta = [article?.byline, article?.readingMinutes.map { "\($0) min" }].compactMap { $0 }.joined(separator: " · ")
                    if !meta.isEmpty { Micro(meta, color: theme.inkSoft).padding(.top, Tokens.Space.md) }

                    if let summary = article?.summary, !summary.isEmpty {
                        HStack(spacing: 0) {
                            theme.isPaper(item.list) ? theme.ink.frame(width: Tokens.rule) : theme.field(item.list).frame(width: Tokens.rule)
                            VStack(alignment: .leading, spacing: Tokens.Space.sm) {
                                Micro("In short")
                                Text(summary).style(T.body).foregroundStyle(theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(Tokens.Space.lg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .background(theme.surfaceSunk)
                        .padding(.top, Tokens.Space.lg)
                    }

                    VStack(alignment: .leading, spacing: Tokens.Space.lg) {
                        ForEach(Array((article?.paragraphs ?? []).enumerated()), id: \.offset) { _, p in
                            Text(p).style(T.read).foregroundStyle(theme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.top, Tokens.Space.xl)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.top, Tokens.Space.xl)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)

            Rule()
            VStack(alignment: .leading, spacing: Tokens.Space.md) {
                Micro(["Kept on this phone", savedOn.map { "saved \($0)" }].compactMap { $0 }.joined(separator: " · "),
                      color: theme.inkSoft)
                if let s = item.sourceURL, let url = URL(string: s) {
                    ShelfButton(title: "Open original →", label: "Open the original page") { openURL(url) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.md)
            .padding(.bottom, Tokens.Space.lg)
        }
        .background(theme.bg.ignoresSafeArea())
    }
}

extension ISO8601DateFormatter {
    /// The file holds dates with and without fractional seconds, and the odd
    /// empty string. Nil rather than a wrong date.
    static func lenient(_ s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        let a = ISO8601DateFormatter()
        a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        let b = ISO8601DateFormatter()
        b.formatOptions = [.withInternetDateTime]
        return b.date(from: s)
    }
}
