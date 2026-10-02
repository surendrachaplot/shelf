// FindScreen.swift — one box for everything you have kept, and everything you have not.
//
// A port of app/src/Find.tsx; its comments are the spec.
//
// TWO SEARCHES, ONE FIELD, IN THE RIGHT ORDER. YOURS comes first and is
// instant: it runs on the phone against the shelf in memory, on every
// keystroke, with no debounce and no spinner (`Find.search`). THE WORLD comes
// second and is debounced: the catalogue search the Add screen uses, with
// anything already on a shelf removed — so the one box answers both "where
// did I put it" and "I have not saved this yet".
//
// A ROW EXPLAINS ITSELF. Searching notes and cities means rows appear whose
// title does not hold what you typed; such a row says where the match came
// from ("your note: …").
//
// Paper: file "shelf" → "Find".
import SwiftUI

/// Same debounce as Add: every keystroke past it is a question somebody's
/// quota pays for. The LOCAL half has none at all.
let searchDebounce = Duration.milliseconds(320)

/// What the "Shelve" button on a catalogue row is doing.
enum Shelving { case adding, done }

struct FindScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    @State private var q = ""
    @State private var only: String?
    @State private var world: [SearchHit] = []
    @State private var looking = false
    @State private var worldError: String?
    @State private var added: [String: Shelving] = [:]

    private static let fieldLabel: [Find.Field: String] = [
        .note: "your note", .caption: "the caption", .subtitle: "the details", .facts: "the details",
        .list: "the shelf", .tags: "a tag", .ocr: "the screenshot", .article: "the article",
    ]

    private struct Mine {
        var hits: [Find.Hit] = []
        /// Shelves with something in them, most first — counted BEFORE the
        /// filter, so picking one never changes what the others say.
        var chips: [(list: String, n: Int)] = []
        var total = 0
    }

    /// YOURS: recomputed on every keystroke, deliberately. One search with no
    /// limit gives the hits, the counts and the chip order; filtering its
    /// hits by shelf is the same list `Find.search(list:)` would return.
    private var mine: Mine {
        let all = Find.search(items: model.items, query: q, limit: .max)
        guard !all.hits.isEmpty else { return Mine() }
        // The chip order is JavaScript's: the order shelves were first met
        // while walking the items, then most-first with ties left as they were.
        let matched = Set(all.hits.map(\.item.id))
        var order: [String] = []
        for it in model.items where matched.contains(it.id) && !order.contains(it.list) { order.append(it.list) }
        let chips = order.enumerated()
            .map { (at: $0.offset, list: $0.element, n: all.counts[$0.element] ?? 0) }
            .sorted { $0.n != $1.n ? $0.n > $1.n : $0.at < $1.at }
            .map { (list: $0.list, n: $0.n) }
        let kept = only == nil ? all.hits : all.hits.filter { $0.item.list == only }
        return Mine(hits: Array(kept.prefix(60)), chips: chips, total: kept.count)
    }

    var body: some View {
        let mine = mine
        let term = q.trimmingCharacters(in: .whitespacesAndNewlines)
        let typed = !term.isEmpty
        // Anything already on a shelf is not news.
        let fresh = world
            .filter { !Find.alreadyShelved(model.items, key: $0.key, title: $0.title, list: $0.list) }
            .filter { only == nil || $0.list == only }

        VStack(spacing: 0) {
            SearchHead(title: "Find", placeholder: "A title, a name, a city — or a word from your note",
                       text: $q, busy: looking) { nav.close() }

            // A chip for an empty shelf is a button that promises nothing.
            // Seven will not fit one line, so they wrap.
            if mine.chips.count > 1 {
                Flow(spacing: Tokens.Space.xs, lineSpacing: Tokens.Space.xs) {
                    chip("All \(mine.total)", label: "Everything", on: only == nil, fill: theme.ink, ink: theme.bg) { only = nil }
                    ForEach(mine.chips, id: \.list) { c in
                        let name = Lists.info(c.list).label
                        chip("\(name) \(c.n)", label: "\(name), \(c.n)", on: only == c.list,
                             fill: theme.field(c.list), ink: theme.on(c.list)) { only = only == c.list ? nil : c.list }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.top, Tokens.Space.md)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if typed, !mine.hits.isEmpty {
                        section("On your shelves").padding(.top, Tokens.Space.md)
                        ForEach(mine.hits, id: \.item.id) { hit in mineRow(hit) }
                    }

                    if typed, mine.hits.isEmpty {
                        notice("Nothing of yours matches “\(term)”",
                               "This looks at every shelf at once — titles, authors, cities, and the notes you wrote. "
                               + (looking ? "Still asking the catalogues…" : "Anything found below is not on a shelf yet."))
                    }

                    // THE WORLD. Second, always, and never mixed into the list
                    // above: a thing you own and a thing you could own are
                    // different answers.
                    if !fresh.isEmpty {
                        section("Not on a shelf yet").padding(.top, Tokens.Space.xl)
                        ForEach(fresh) { hit in
                            CatalogueRow(hit: hit, state: added[hit.key], doneLabel: "On your shelf") { shelve(hit) }
                        }
                    }

                    if let worldError, typed {
                        notice("Your shelves are here; the catalogues are not",
                               "Everything above came off this phone and is complete. The lookup for things you have not saved could not reach the server (\(worldError)).")
                    }

                    if !typed {
                        let n = model.items.count
                        notice("Look through everything at once", n > 0
                               ? "\(n) \(n == 1 ? "thing" : "things") across your shelves. Search a title, an author, a neighbourhood, a cuisine, a year — or a word from a note you wrote. Type a shelf's name to see all of it."
                               : "Your shelves are empty for now. Share a reel from Instagram, or type a name here and shelve it straight from the catalogue.")
                        // The other way in: not "what was it called" but "what
                        // else is in Peckham". Only when there is something to browse.
                        Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                            ShelfButton(title: "Your lists →", label: "Your lists") { nav.showLists() }
                            if n > 0 { ShelfButton(title: "Browse by tag →", label: "Browse by tag") { nav.showTag(nil) } }
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                        .padding(.top, Tokens.Space.lg)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Tokens.Space.md)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(theme.bg.ignoresSafeArea())
        // THE WORLD: debounced. A new keystroke cancels the wait AND the
        // request, so an answer to a query already typed past never lands.
        .task(id: q) {
            try? await Task.sleep(for: searchDebounce)
            if Task.isCancelled { return }
            await askCatalogues(q)
        }
    }

    private func askCatalogues(_ term: String) async {
        guard term.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            world = []; looking = false; worldError = nil
            return
        }
        looking = true
        worldError = nil
        do {
            let r = try await model.api.search(term, list: nil, city: model.shelf.profile.homeCity)
            if Task.isCancelled { return }
            world = r.results
        } catch {
            if Task.isCancelled { return }
            world = []
            worldError = error.localizedDescription
        }
        looking = false
    }

    /// NOTHING IS SENT ANYWHERE: it goes straight onto this phone, filed, with
    /// an id made from the catalogue key so the same book twice is one row.
    private func shelve(_ hit: SearchHit) {
        added[hit.key] = .adding
        let now = Drain.iso(Date())
        model.add(Item(id: Store.idFor("catalogue:\(hit.key)"), list: hit.list, status: .filed, title: hit.title,
                       subtitle: hit.subtitle, note: "", imageURL: hit.imageURL, canonical: hit.canonical,
                       confidence: 1, enriched: true, sourceURL: nil, resolver: "search", createdAt: now, resolvedAt: now))
        added[hit.key] = .done
    }

    /// One thing you already have. Tapping it opens it.
    private func mineRow(_ hit: Find.Hit) -> some View {
        let item = hit.item
        let shelf = Lists.info(item.list).label
        // Only when the title does not say it.
        let why: String? = {
            guard let field = hit.why, let snippet = hit.snippet, !snippet.isEmpty else { return nil }
            return "\(Self.fieldLabel[field] ?? field.rawValue): \(snippet)"
        }()
        return Press("Open \(item.title ?? "this") on \(shelf)", size: Tokens.touchMin, action: { nav.show(item) }) {
            ItemRow(list: item.list, title: item.title ?? "Not read yet",
                    subtitle: [item.subtitle, shelf].filter { !$0.isEmpty }.joined(separator: " · "),
                    third: why, art: item.imageURL, compact: true)
        }
        .padding(.horizontal, Tokens.Space.lg)
        .padding(.top, Tokens.Space.sm)
    }

    private func chip(_ text: String, label: String, on: Bool, fill: Color, ink: Color, action: @escaping () -> Void) -> some View {
        Press(label, size: Tokens.touchMin, action: action) {
            Text(text).style(T.micro).monospacedDigit().foregroundStyle(on ? ink : theme.ink)
                .modifier(InkBox(border: Tokens.rule, fill: on ? fill : nil))
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func section(_ text: String) -> some View {
        Text(text).style(T.section).foregroundStyle(theme.inkSoft)
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.bottom, Tokens.Space.xs)
    }

    private func notice(_ title: String, _ body: String) -> some View { Notice(title: title, text: body) }
}

/// A title and a sentence: "zero" and "couldn't look" each get their own.
struct Notice: View {
    @Environment(\.theme) private var theme
    var title: String
    var text: String
    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.xs) {
            Text(title).style(T.section).foregroundStyle(theme.ink)
            Text(text).rowLine(T.meta).foregroundStyle(theme.inkSoft)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Tokens.Space.lg)
        .padding(.top, Tokens.Space.xl)
    }
}

/// A field you type into: a 2pt ink outline, radius zero. The whole box takes
/// the tap, not only the line of text inside it.
struct InkField: View {
    @Environment(\.theme) private var theme
    var placeholder: String
    @Binding var text: String
    var style: TextStyle = T.bodyMed
    var autoFocus = false
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(theme.inkFaint))
            .style(style)
            .foregroundStyle(theme.ink)
            .tint(theme.ink)
            .focused($focused)
            .modifier(InkBox(minHeight: Tokens.touchMin + 8, fill: theme.bg))
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            .onAppear { if autoFocus { focused = true } }
            .accessibilityLabel(placeholder)
    }
}

/// The top of Find and Add: the wordmark, Close on its BASELINE, the rule, and
/// the one field with the spinner beside it.
struct SearchHead: View {
    @Environment(\.theme) private var theme
    var title: String
    var placeholder: String
    @Binding var text: String
    var busy: Bool
    var onSubmit: () -> Void = {}
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(title).style(T.wordmark).foregroundStyle(theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                TextAction(title: "Close", action: onClose)
            }
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.xl)
            .padding(.bottom, Tokens.Space.md)
            Rule()
            HStack(spacing: Tokens.Space.sm) {
                InkField(placeholder: placeholder, text: $text, autoFocus: true)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                    .onSubmit(onSubmit)
                if busy { ProgressView().tint(theme.inkFaint).frame(width: Tokens.Space.xl) }
            }
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.md)
        }
    }
}

/// One thing you do not have yet, with the button that shelves it. The shelf
/// colour runs down the left edge as a rule, not a chip.
struct CatalogueRow: View {
    @Environment(\.theme) private var theme
    var hit: SearchHit
    var state: Shelving?
    /// What VoiceOver says once it is on the shelf.
    var doneLabel: String
    var onShelve: () -> Void

    var body: some View {
        let shelf = Lists.info(hit.list).label
        let done = state == .done
        ItemRow(list: hit.list, title: hit.title,
                subtitle: [hit.subtitle, shelf].filter { !$0.isEmpty }.joined(separator: " · "),
                art: hit.imageURL, compact: true) {
            Press(done ? doneLabel : "Put on \(shelf)", size: Tokens.touchMin, disabled: state != nil, action: onShelve) {
                ZStack {
                    if state == .adding { ProgressView().tint(theme.ink) }
                    else { Text(done ? "Shelved" : "Shelve").style(T.micro).foregroundStyle(done ? theme.on(hit.list) : theme.ink) }
                }
                .padding(.horizontal, Tokens.Space.md)
                .frame(minHeight: Tokens.touchMin)
                .background(done ? theme.field(hit.list) : Color.clear)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, Tokens.Space.lg)
        .padding(.top, Tokens.Space.sm)
    }
}

#if DEBUG
#Preview("Find") { FixtureStage { FindScreen() } }
#Preview("Find, dark") { FixtureStage { FindScreen() }.preferredColorScheme(.dark) }
#endif
