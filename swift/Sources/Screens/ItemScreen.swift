// ItemScreen.swift — the jacket at full size.
//
// A port of `Detail`, `PriceBlock`, `Facts` and `openLink` in app/App.tsx, value
// for value. The whole screen is the shelf's FIELD colour and every word on it
// is `theme.on(list)` — the one pairing that is contrast-checked in both
// schemes. No opacities: a label at 86% is a ratio nobody computed.
//
// The kicker stays at the head and the rest stands on the foot (the RN scroll
// content is `space-between`), so a thing with nothing known about it is a
// poster with its mass at the bottom, not a page that stopped.
//
// EVERY EDIT CLOSES THE PAGE, as `act` in App.tsx does: move it, note it, pin
// it, shelve it, remove it — you are back on the shelf looking at the result.
import SwiftUI

/// The numbers the RN StyleSheet writes out by hand. Named here so they are
/// not sprinkled through the layout; none of them is a type size or a colour.
private enum M {
    /// `factLabel.width` — a fixed label column, so every value starts on one x.
    static let factLabel: CGFloat = 104
    /// `detailArt.aspectRatio`.
    static let art: CGFloat = 3.0 / 4.0
    /// `detailNoteInput.minHeight` is TOUCH_MIN + 32.
    static let noteInput = Tokens.touchMin + 32
    /// `detailMove.gap` — the same 2pt the rail leaves between its blocks.
    static let moveGap: CGFloat = 2
    static let border: CGFloat = 2
    static let noteMax = 1000
    /// Three titles under a heading; the heading's count opens the rest.
    static let linkRows = 3
}

// How a connection is said out loud. "Also by" for a writer, "Also in" for a
// place — the reason is the whole point of the link, so it is not "Related".
private let also = ["author": "Also by", "director": "Also directed by", "cast": "Also with", "area": "Also in", "city": "Also in"]

extension Theme {
    /// The placeholder colour on a shelf's field: the label mixed toward the
    /// field (design.js `placeholderOn`), so an empty box reads as empty.
    func ghost(on list: String) -> Color {
        let hex = DesignMath.placeholderOn(list, dark ? DesignConstants.dark : DesignConstants.light)
        return UInt32(hex.dropFirst(), radix: 16).map(Color.init(hex:)) ?? on(list)
    }
}

/// "Couldn't open maps.apple.com/?q=…" — naming the URL, because "couldn't
/// open this" with nothing else is the same dead end as no message at all.
private func couldNotOpen(_ url: String) -> String {
    let bare = url.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression)
    return "Couldn't open \(bare.prefix(40))"
}

struct ItemScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    let item: Item
    @State private var note: String
    @State private var editingNote = false
    @FocusState private var noteFocused: Bool
    /// A link that would not open, said where the button is.
    @State private var factsFail: String?
    @State private var reelFail: String?

    init(item: Item) {
        self.item = item
        _note = State(initialValue: item.note)
    }

    private var list: String { item.list }
    private var on: Color { theme.on(list) }
    private var fill: Color { theme.field(list) }
    private var isNote: Bool { item.kind == "note" }

    /// OPEN A LINK, OR SAY WHY NOT. A Map button built from a `geo:` URL once
    /// spent weeks doing nothing at all on an iPhone, silently.
    private func open(_ url: String, fail: @escaping (String?) -> Void) {
        guard let u = URL(string: url) else { fail(couldNotOpen(url)); return }
        fail(nil)
        openURL(u) { accepted in if !accepted { fail(couldNotOpen(url)) } }
    }

    /// `act` in App.tsx: the page closes, then the shelf changes.
    private func act(_ edit: ItemEdit) {
        nav.open = nil
        model.edit(item, edit)
    }

    var body: some View {
        let facts = Facts.for(item, platform: .ios, price: false)
        let links = Links.for(item, in: model.items)
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    // `space-between`: the free height is shared by the gaps
                    // between the blocks, so each block is followed by a spring.
                    VStack(alignment: .leading, spacing: 0) {
                        head
                        Spacer(minLength: 0)
                        if let art = item.imageURL, !art.isEmpty {
                            artwork(art)
                            Spacer(minLength: 0)
                        }
                        if let price = priceBlock {
                            price
                            Spacer(minLength: 0)
                        }
                        if facts.lede != nil || !facts.rows.isEmpty || !facts.links.isEmpty {
                            factsBlock(facts)
                            Spacer(minLength: 0)
                        }
                        ForEach(Array(links.enumerated()), id: \.offset) { _, g in
                            connection(g)
                            Spacer(minLength: 0)
                        }
                        foot
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Tokens.Space.lg)
                    .padding(.top, Tokens.Space.xxl)
                    .padding(.bottom, Tokens.Space.xl)
                    .frame(minHeight: geo.size.height, alignment: .top)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
                // NOTHING YOU TYPE INTO MAY SIT UNDER THE KEYBOARD — and nor
                // may the button that saves it. The scroll view already gives
                // way to the keyboard; this brings Save / Cancel above it.
                .onChange(of: noteFocused) { _, focused in
                    guard focused else { return }
                    Task {
                        try? await Task.sleep(for: .milliseconds(Tokens.Duration.slow))
                        withAnimation { proxy.scrollTo("note-actions", anchor: .bottom) }
                    }
                }
            }
        }
        .background(fill.ignoresSafeArea())
    }

    // ── head ────────────────────────────────────────────────────────────────

    private var head: some View {
        let info = Lists.info(list)
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Micro("\(info.n) · \(info.label)", color: on).monospacedDigit()
                Spacer(minLength: Tokens.Space.md)
                TextAction(title: "Close", color: on) { nav.open = nil }
            }
            Rule(color: on).padding(.vertical, Tokens.Space.md)
            Text(item.title ?? "Couldn't read this one").style(T.detailTitle).foregroundStyle(on)
                .fixedSize(horizontal: false, vertical: true)
            if !item.subtitle.isEmpty {
                Text(item.subtitle).style(T.bodyMed).foregroundStyle(on)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Tokens.Space.md)
            }
        }
    }

    // ── artwork ─────────────────────────────────────────────────────────────

    /// The frame we pulled off the reel. With NO picture the field stays empty
    /// on purpose (see `body`) — that gap is the composition. A picture that
    /// FAILED is different news, so it gets a plate that says so: a 404 that
    /// leaves an empty box reads as breakage.
    private func artwork(_ art: String) -> some View {
        Color.clear
            .aspectRatio(M.art, contentMode: .fit)
            .overlay {
                AsyncImage(url: URL(string: art)) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    case .failure: artFailed
                    default: if URL(string: art) == nil { artFailed } else { Color.clear }
                    }
                }
            }
            .clipped()
            .overlay(Rectangle().strokeBorder(on, lineWidth: Tokens.coverKeyline))
            .padding(.vertical, Tokens.Space.xl)
            .accessibilityHidden(true)
    }

    private var artFailed: some View {
        VStack(alignment: .leading, spacing: 0) {
            Micro("The picture did not load", color: on)
            Spacer(minLength: Tokens.Space.lg)
            Text(item.title ?? "").style(T.band).foregroundStyle(on).lineLimit(4)
        }
        .padding(Tokens.Space.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // ── price ───────────────────────────────────────────────────────────────

    /// WHAT A THING TO BUY COSTS, at the size of the decision it is. Beside
    /// it, on the same baseline: whether it can be bought, and the day the
    /// price was read — a price is true on a day. Each part is left out when
    /// it is not known, and with no price there is no block at all.
    private var priceBlock: AnyView? {
        guard item.kind == "product", let price = ListsLogic.priceOn(item) else { return nil }
        let c = item.canonical
        var read: String?
        if let at = c["price_at"]?.string, let ms = JSLogic.dateParse(at) {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_GB")
            f.dateFormat = "d MMM"
            read = "Price read \(f.string(from: Date(timeIntervalSince1970: ms / 1000)))"
        }
        let said = [Facts.stock[c["availability"]?.string ?? ""], read].compactMap { $0 }.joined(separator: " · ")
        let amount = Text(price).style(T.detailTitle).monospacedDigit().foregroundStyle(on)
        let small = Micro(said, color: on).monospacedDigit()
        return AnyView(
            // Baseline, so the small line sits on the foot of the figures.
            // Wraps: "€1,249.50" and a status do not share 288pt.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.md) {
                    amount
                    Spacer(minLength: 0)
                    if !said.isEmpty { small.lineLimit(1) }
                }
                VStack(alignment: .leading, spacing: 0) {
                    amount
                    if !said.isEmpty { small.fixedSize(horizontal: false, vertical: true) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, Tokens.Space.xl)
        )
    }

    // ── what the catalogue knows ────────────────────────────────────────────

    private func factsBlock(_ f: Facts.Result) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rule(color: on).padding(.vertical, Tokens.Space.md)
            if let lede = f.lede {
                Text(lede).style(T.body).foregroundStyle(on)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Tokens.Space.lg)
            }
            ForEach(Array(f.rows.enumerated()), id: \.offset) { _, r in
                // Label left, value right, both on one baseline.
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.md) {
                    Micro(r.label, color: on)
                        .frame(width: M.factLabel, alignment: .leading)
                    Text(r.value).style(T.bodyMed).monospacedDigit().foregroundStyle(on)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.top, Tokens.Space.md)
                .accessibilityElement(children: .combine)
            }
            if !f.links.isEmpty {
                Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                    ForEach(Array(f.links.enumerated()), id: \.offset) { _, l in
                        ShelfButton(title: "\(l.label) →", on: on, field: fill, label: l.label) {
                            open(l.url) { factsFail = $0 }
                        }
                    }
                }
                .padding(.top, Tokens.Space.lg)
            }
            if let factsFail { failure(factsFail) }
        }
        .padding(.top, Tokens.Space.xl)
    }

    private func failure(_ said: String) -> some View {
        Text(said).style(T.meta).foregroundStyle(on)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, Tokens.Space.sm)
    }

    // ── connections nobody had to make ──────────────────────────────────────

    private func connection(_ g: Links.Group) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rule(color: on).padding(.vertical, Tokens.Space.md)
            Press("Everything tagged \(g.reason.value)", size: Tokens.touchMin,
                  action: { nav.showTag(Tags.key(kind: g.reason.kind, value: g.reason.value)) }) {
                HStack(spacing: Tokens.Space.md) {
                    Micro("\(also[g.reason.kind] ?? "Also") \(g.reason.value)", color: on).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Micro("\(String(format: "%02d", g.items.count)) →", color: on).monospacedDigit()
                }
                .frame(minHeight: Tokens.touchMin)
            }
            ForEach(g.items.prefix(M.linkRows)) { it in
                Press("Open \(it.title ?? "it")", size: Tokens.touchMin, action: { nav.open = it }) {
                    Text(it.title ?? "").style(T.bodyMed).fontWeight(.bold).foregroundStyle(on).lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: Tokens.touchMin, alignment: .leading)
                }
            }
        }
        .padding(.top, Tokens.Space.xl)
    }

    // ── yours: the note, the shelf, the actions ─────────────────────────────

    private var foot: some View {
        // A note's first line is already the title above, so the field shows
        // what comes after it. Tapping still opens the whole text.
        let shown = isNote
            ? note.split(separator: "\n", omittingEmptySubsequences: false).dropFirst().joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            : note
        let onLists = ListsLogic.lists(model.shelf.boards, with: item.id)
        return VStack(alignment: .leading, spacing: 0) {
            if editingNote {
                TextField("", text: $note,
                          prompt: Text("What you thought about it").foregroundStyle(theme.ghost(on: list)),
                          axis: .vertical)
                    .style(T.body).foregroundStyle(on).tint(on)
                    .focused($noteFocused)
                    .padding(Tokens.Space.md)
                    .frame(minHeight: M.noteInput, alignment: .topLeading)
                    .overlay(Rectangle().strokeBorder(on, lineWidth: M.border))
                    .contentShape(Rectangle())
                    .onTapGesture { noteFocused = true }
                    .onAppear { noteFocused = true }
                    .padding(.top, Tokens.Space.md)
                    .onChange(of: note) { _, now in if now.count > M.noteMax { note = String(now.prefix(M.noteMax)) } }
                    .accessibilityLabel("Your note")
                HStack(spacing: Tokens.Space.sm) {
                    ShelfButton(title: "Save note", kind: .fill, on: on, field: fill, label: "Save the note") {
                        act(ItemEdit(note: note))
                    }
                    ShelfButton(title: "Cancel", on: on, field: fill) {
                        note = item.note
                        editingNote = false
                    }
                }
                .padding(.top, Tokens.Space.xl)
                .id("note-actions")
            } else {
                Press(note.isEmpty ? "Add a note" : "Edit your note", size: Tokens.touchMin,
                      action: { editingNote = true }) {
                    Text(shown.isEmpty ? (isNote ? "Tap to write more" : "Add a note — what you thought, why you saved it") : shown)
                        .style(T.body).foregroundStyle(shown.isEmpty ? theme.ghost(on: list) : on)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, Tokens.Space.md)
                        .frame(maxWidth: .infinity, minHeight: Tokens.touchMin, alignment: .leading)
                }
            }

            // Auto-classification gets it wrong sometimes, and a thing on the
            // wrong shelf is the one defect the owner can see and nobody else
            // can fix. One block per shelf, the current one outlined.
            Micro("Shelf", color: on).padding(.top, Tokens.Space.xl)
            HStack(spacing: M.moveGap) {
                ForEach(Lists.shelves, id: \.key) { l in
                    Press("Move to \(l.label)", size: Tokens.touchMin, action: { act(ItemEdit(list: l.key)) }) {
                        Text(l.n).style(T.micro).monospacedDigit().foregroundStyle(theme.on(l.key))
                            .frame(maxWidth: .infinity, minHeight: Tokens.touchMin)
                            .background(theme.field(l.key))
                            .overlay(Rectangle().strokeBorder(l.key == list ? on : .clear, lineWidth: M.border))
                    }
                    .accessibilityAddTraits(l.key == list ? .isSelected : [])
                }
            }
            .padding(.top, Tokens.Space.sm)

            Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                if Article(item) != nil {
                    ShelfButton(title: "Read →", kind: .fill, on: on, field: fill, label: "Read the saved article") {
                        nav.reading = item
                    }
                }
                ShelfButton(title: "Share →", kind: .fill, on: on, field: fill, label: "Share this") {
                    nav.sharing = Sharing(kind: .item, item: item, list: item.list, title: item.title ?? "This one")
                }
                ShelfButton(title: "Add to a list →", on: on, field: fill, label: "Add to a list") {
                    nav.showLists(adding: item)
                }
                ShelfButton(title: item.top ? "Unpin" : "Pin", on: on, field: fill,
                            label: item.top ? "Unpin from the top" : "Pin to the top") {
                    act(ItemEdit(top: !item.top))
                }
                if let source = item.sourceURL, !source.isEmpty {
                    ShelfButton(title: "Open reel →", on: on, field: fill, label: "Open the reel") {
                        open(source) { reelFail = $0 }
                    }
                }
                if item.status != .filed {
                    ShelfButton(title: "Shelve it →", on: on, field: fill, label: "Shelve it") {
                        act(ItemEdit(file: true))
                    }
                }
                ShelfButton(title: "Remove", on: on, field: fill) {
                    nav.open = nil
                    model.remove(item)
                }
            }
            .padding(.top, Tokens.Space.xl)
            if let reelFail { failure(reelFail) }

            if !onLists.isEmpty {
                Micro("On \(onLists.count) \(onLists.count == 1 ? "list" : "lists") · \(onLists.map(\.name).joined(separator: ", "))", color: on)
                    .monospacedDigit().lineLimit(2)
                    .padding(.top, Tokens.Space.md)
            }
            Rule(color: on).padding(.top, Tokens.Space.xl)
            // "No confidence recorded" and "low confidence" must never render
            // the same way. One means we could not look at it; the other means
            // we did and were unsure.
            Micro(provenance, color: on).monospacedDigit()
                .padding(.top, Tokens.Space.md)
        }
    }

    private var provenance: String {
        if let from = item.canonical["from"]?.string, !from.isEmpty { return "From @\(from)" }
        // A note was never read by anything: somebody wrote it.
        if isNote { return "Written by you" }
        guard let c = item.confidence else { return "Not read yet" }
        return "\(Int((c * 100).rounded()))% sure · \(item.enriched ? "matched to a catalogue" : "from the caption only")"
    }
}

// ── previews ────────────────────────────────────────────────────────────────

#if DEBUG
/// The bundled fixture shelf, in a scratch folder, with the network pointed at
/// nothing — for `#Preview`s of the screens that need a shelf.
struct FixturePreviewHost<Content: View>: View {
    @State private var model: AppModel = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-preview-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let src = Bundle.main.url(forResource: "shelf", withExtension: "json", subdirectory: "Debug")
            ?? Bundle.main.url(forResource: "shelf", withExtension: "json") {
            try? FileManager.default.copyItem(at: src, to: dir.appendingPathComponent("shelf.json"))
        }
        return AppModel(directory: dir, api: API(base: URL(string: "http://127.0.0.1:9")!))
    }()
    @State private var nav = Nav()
    @ViewBuilder var content: (AppModel) -> Content

    var body: some View {
        Themed {
            ZStack { if model.ready { content(model) } }
        }
        .environment(model)
        .environment(nav)
        .task { await model.boot() }
    }
}

private struct ItemPreview: View {
    var id: String
    var body: some View {
        FixturePreviewHost { model in
            if let item = model.item(id) { ItemScreen(item: item) }
        }
    }
}

#Preview("Restaurant") { ItemPreview(id: "restaurants-2") }
#Preview("Book, dark") { ItemPreview(id: "books-0").preferredColorScheme(.dark) }
#Preview("Product") { ItemPreview(id: "w1") }
#Preview("Note") { ItemPreview(id: "n2") }
#Preview("Movie (yellow)") { ItemPreview(id: "movies-0") }
#endif
