// HomeScreen.swift — the bookcase. A port of the home screen in app/App.tsx.
//
// ONE LIST AT A TIME, FILLING THE SCREEN. A colour rail picks the shelf, a
// full-bleed band names it, and its jackets wrap left to right across as many
// boards as they need — so the count in the band is a promise, because
// everything it counts is on screen.
//
// The paddings, gaps and minimum heights below are the Expo app's `styles`
// one for one; the names in the comments are the names there.
import SwiftUI

struct HomeScreen: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.openURL) private var openURL
    /// The scroll view's own size: the columns are solved from its width, the
    /// empty boards from its height.
    @State private var viewport: CGSize = .zero

    // Values the Expo `styles` hold as plain numbers (no token names them).
    private static let railGap: CGFloat = 2            // rail
    private static let edge: CGFloat = 2               // pin, again, bandPaper: borderWidth 2
    private static let plate: CGFloat = 36             // <ExLibris size={36}>
    private static let pinMinW: CGFloat = 96           // pinSlot
    private static let hair: CGFloat = 2               // againTitle / againSub marginTop
    private let inset = Tokens.Space.lg

    var body: some View {
        let tab = nav.tab
        let showing = model.items(on: tab)
        // The shelf is empty because the FILE would not open, and the notice
        // already says so.
        let quiet = model.state == .unreadable

        VStack(spacing: 0) {
            ViewThatFits(in: .horizontal) {
                head(compact: false)
                head(compact: true)
            }
            rail(tab)
            band(tab, showing)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let flash = model.flash {
                        Text(flash).lineBox(T.meta).foregroundStyle(theme.accent)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, inset)
                            .padding(.bottom, Tokens.Space.sm)
                    }
                    if !quiet, !model.pinned.isEmpty { pinnedRow(model.pinned) }
                    // One card, at the top of the scroll and not between the
                    // rail and the band: a strip there would cut the bridge.
                    if !quiet, tab != "unsorted", let card = model.again() { again(card) }
                    if quiet { rescue }

                    if tab == "unsorted" { pile(showing, quiet: quiet) } else { bookcase(tab, showing, quiet: quiet) }

                    if model.busy {
                        ProgressView().tint(theme.inkFaint)
                            .frame(maxWidth: .infinity)
                            .padding(.top, Tokens.Space.lg)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
            // The shelves are on this phone, so there is nothing to fetch. A
            // pull still takes what the share extension has left.
            .refreshable { await model.refresh() }
            .tint(theme.inkFaint)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { viewport = $0 }
        }
        .background(theme.bg)
    }

    // ── head ─────────────────────────────────────────────────────────────────

    private var seed: String {
        let p = model.shelf.profile
        return !p.seed.isEmpty ? p.seed : !p.name.isEmpty ? p.name : "shelf"
    }

    /// The wordmark and the tools. `compact` is the same row with the air
    /// taken out, for a 320pt phone: there the full row is 30pt wider than
    /// the screen.
    private func head(compact: Bool) -> some View {
        HStack(spacing: 0) {
            Text("shelf").lineBox(T.wordmark).foregroundStyle(theme.ink).fixedSize()
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: compact ? 0 : Tokens.Space.sm) {
                // Find is FIRST: with nine shelves, "which shelf did I put it
                // on" is the question people have.
                tool("Find", "Search everything you have saved", .find, compact)
                tool("Add", "Add something by name", .add, compact)
                tool("Import", "Import screenshots", .importPictures, compact)
                Press("Your card", size: Tokens.touchMin, action: { nav.screen = .profile }) {
                    PlateView(seed: seed, size: HomeScreen.plate)
                        .frame(minHeight: Tokens.touchMin)
                        .padding(.horizontal, Tokens.Space.xs)
                }
                // Painted 36pt wide, pressed 44pt wide.
                .padding(.leading, compact ? 0 : -Tokens.Space.xs)
                .padding(.trailing, -Tokens.Space.xs)
            }
        }
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.xl)
        .padding(.bottom, Tokens.Space.md)
    }

    private func tool(_ title: String, _ label: String, _ route: Route, _ compact: Bool) -> some View {
        Press(label, size: Tokens.touchMin, action: { nav.screen = route }) {
            Text(title).lineBox(T.micro).foregroundStyle(theme.inkFaint).fixedSize()
                .padding(.horizontal, compact ? Tokens.Space.xs : Tokens.Space.sm)
                .frame(minWidth: compact ? Tokens.touchMin : nil, minHeight: Tokens.touchMin)
        }
    }

    // ── rail ─────────────────────────────────────────────────────────────────

    /// One flat block per shelf, carrying nothing but its series number: at
    /// 30pt wide no name fits, and the band below already names it.
    private func rail(_ tab: String) -> some View {
        HStack(alignment: .top, spacing: HomeScreen.railGap) {
            ForEach(Lists.all, id: \.key) { info in railBlock(info, selected: info.key == tab) }
        }
        .padding(.horizontal, inset)
        .padding(.bottom, Tokens.Space.xs)
    }

    private func railBlock(_ info: ListInfo, selected: Bool) -> some View {
        let k = info.key
        // Notes is paper: an ink outline around the page, not a fill.
        let keyline = theme.isPaper(k) ? Tokens.coverKeyline : 0
        // The selected block runs 4pt down to meet the band, so tab and panel
        // are one field.
        let bridge = selected ? Tokens.Space.xs : 0
        let slopX = HomeScreen.railGap / 2, slopY = Tokens.Space.xs
        return Press("\(info.label), \(model.items(on: k).count) items", size: Tokens.touchMin, action: { nav.tab = k }) {
            Text(info.n).lineBox(T.tag).monospacedDigit().foregroundStyle(theme.on(k))
                .frame(maxWidth: .infinity)
                .frame(height: Tokens.touchMin)
                .padding(.bottom, bridge)
                .background(theme.field(k))
                .overlay(alignment: .top) { theme.ink.frame(height: keyline) }
                .overlay(alignment: .leading) { theme.ink.frame(width: keyline) }
                .overlay(alignment: .trailing) { theme.ink.frame(width: keyline) }
                // Open at the foot when selected, so the block runs into the
                // band's own top rule.
                .overlay(alignment: .bottom) { theme.ink.frame(height: selected ? 0 : keyline) }
                // What a finger gets: the block, half of each gap beside it,
                // and 4pt above and below. Blocks never share a point.
                .padding(.horizontal, slopX)
                .padding(.vertical, slopY)
        }
        .padding(.horizontal, -slopX)
        .padding(.top, -slopY)
        .padding(.bottom, -slopY - bridge)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // ── band ─────────────────────────────────────────────────────────────────

    /// WRAPS, and the label is as wide as its word. With a total on it the
    /// Wishlist band does not fit one line at 320pt; what moves down is the
    /// meta, as a unit.
    private func band(_ tab: String, _ showing: [Item]) -> some View {
        let paper = theme.isPaper(tab)
        let rule = paper ? HomeScreen.edge : 0
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: Tokens.Space.md) {
                bandLabel(tab)
                bandAction(tab)
                bandMeta(tab, showing)
            }
            VStack(alignment: .trailing, spacing: 0) {
                HStack(spacing: Tokens.Space.md) {
                    bandLabel(tab)
                    bandAction(tab)
                }
                bandMeta(tab, showing)
            }
        }
        .padding(.horizontal, inset)
        .padding(.vertical, Tokens.Space.md + rule)
        .background(theme.field(tab))
        // Paper has no edge, so the band is ruled above and below.
        .overlay(alignment: .top) { theme.ink.frame(height: rule) }
        .overlay(alignment: .bottom) { theme.ink.frame(height: rule) }
    }

    private func bandLabel(_ tab: String) -> some View {
        Text(Lists.info(tab).label).lineBox(T.band).foregroundStyle(theme.on(tab)).lineLimit(1)
            .accessibilityAddTraits(.isHeader)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The pile is not a shelf you can hand to anyone. Notes are what you
    /// wrote to yourself: the control on that band writes one.
    @ViewBuilder private func bandAction(_ tab: String) -> some View {
        let label = Lists.info(tab).label
        if tab == "notes" {
            Press("Write a note", size: Tokens.touchMin, action: { nav.writing = true; nav.writingFor = nil }) {
                Text("Write →").lineBox(T.micro).foregroundStyle(theme.field(tab)).fixedSize()
                    .padding(.horizontal, Tokens.Space.md)
                    .frame(minHeight: Tokens.touchMin)
                    .background(theme.on(tab))
            }
        } else if tab != "unsorted" {
            Press("Share the \(label) shelf", size: Tokens.touchMin,
                  action: { nav.sharing = Sharing(kind: .shelf, list: tab, title: "Your \(label.lowercased()) shelf") }) {
                Text("Share").lineBox(T.micro).foregroundStyle(theme.on(tab)).fixedSize()
                    .padding(.horizontal, Tokens.Space.sm)
                    .frame(minHeight: Tokens.touchMin)
            }
        }
    }

    /// The total and the count stay together.
    private func bandMeta(_ tab: String, _ showing: [Item]) -> some View {
        // What the Wishlist comes to. One line per currency, never added
        // together, and nothing at all when nothing has a price.
        let money = tab == "wishlist" ? ListsLogic.shelfTotal(showing).byCurrency : []
        let on = theme.on(tab)
        return HStack(spacing: Tokens.Space.md) {
            if !money.isEmpty {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach(money, id: \.currency) { line in
                        Text("\(line.text) in all").lineBox(T.micro).monospacedDigit().foregroundStyle(on).fixedSize()
                    }
                }
            }
            Text(String(format: "%02d", showing.count)).lineBox(T.micro).monospacedDigit().foregroundStyle(on).fixedSize()
                .accessibilityLabel("\(showing.count) items")
        }
    }

    // ── pinned ───────────────────────────────────────────────────────────────

    /// What you said matters right now, on every shelf. Three at most.
    private func pinnedRow(_ pinned: [Item]) -> some View {
        // `flexWrap` with `flex: 1, minWidth: 96`: as many as fit at 96pt,
        // and each row shares its width equally.
        let cols = max(1, Int((viewport.width - inset * 2 + Tokens.Space.sm) / (HomeScreen.pinMinW + Tokens.Space.sm)))
        return VStack(alignment: .leading, spacing: Tokens.Space.sm) {
            Text("Pinned").lineBox(T.micro).foregroundStyle(theme.inkSoft)
            ForEach(DesignMath.rowsOf(pinned.count, cols: cols), id: \.self) { row in
                HStack(spacing: Tokens.Space.sm) {
                    ForEach(row.map { pinned[$0] }) { pin($0) }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.md)
    }

    private func pin(_ item: Item) -> some View {
        let h = Tokens.touchMin + Tokens.Space.md
        var title = T.meta
        title.weight = .bold
        return Press("Open \(item.title ?? "it"), pinned", size: h, action: { nav.open = item }) {
            HStack(spacing: 0) {
                theme.field(item.list).frame(width: Tokens.Space.sm)
                Text(item.title ?? "Not read yet").lineBox(title).foregroundStyle(theme.ink)
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .padding(Tokens.Space.sm)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(minHeight: h - HomeScreen.edge * 2)
            .padding(HomeScreen.edge)
            .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: HomeScreen.edge))
        }
    }

    // ── saved a year ago ─────────────────────────────────────────────────────

    private func again(_ card: Serendipity.Card) -> some View {
        let item = card.item
        let title = item.title ?? ""
        return HStack(spacing: 0) {
            ShelfBlock(list: item.list)
            VStack(alignment: .leading, spacing: 0) {
                Text(card.reason).lineBox(T.micro).foregroundStyle(card.action != nil ? theme.good : theme.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                Text(title).lineBox(T.itemTitle).foregroundStyle(theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, HomeScreen.hair)
                if !item.subtitle.isEmpty {
                    Text(item.subtitle).lineBox(T.meta).foregroundStyle(theme.inkSoft).lineLimit(1)
                        .padding(.top, HomeScreen.hair)
                }
                Flow(spacing: Tokens.Space.lg, lineSpacing: Tokens.Space.lg) {
                    if card.action != nil {
                        // The DEVICE builds the map link: only it knows what it can open.
                        TextAction(title: "Map →", label: "Map for \(title)") {
                            if let s = Facts.mapURL(item, platform: .ios), let url = URL(string: s) { openURL(url) }
                        }
                    } else {
                        TextAction(title: "Open →", label: "Open \(title)") { nav.open = item }
                    }
                    TextAction(title: "Not now", color: theme.inkSoft) { model.waved.append(item.id) }
                }
                .padding(.top, Tokens.Space.xs)
            }
            .padding(Tokens.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(HomeScreen.edge)
        .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: HomeScreen.edge))
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.md)
    }

    // ── a shelf that would not open ──────────────────────────────────────────

    /// An empty shelf and a shelf that would not open are the same picture and
    /// completely different news. This says what happened, in bytes and in the
    /// real error, and offers the copies back.
    private var rescue: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.sm) {
            Text("Your shelf didn't open").lineBox(T.section).foregroundStyle(theme.ink)
            Text(model.stateNote ?? "Something went wrong reading the file. Nothing has been deleted.")
                .lineBox(T.meta).foregroundStyle(theme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Tokens.Space.xs)
            if model.canRestore > 0 {
                // Its natural width: a restore stretched edge to edge reads as
                // the primary action of the screen.
                ShelfButton(title: "Put \(model.canRestore) back →", label: "Put \(model.canRestore) items back") { model.restore() }
            }
        }
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.lg)
        .padding(.bottom, Tokens.Space.md)
    }

    // ── the pile ─────────────────────────────────────────────────────────────

    @ViewBuilder private func pile(_ items: [Item], quiet: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
                if !quiet {
                    emptyCopy("Nothing waiting",
                              "Share a reel from Instagram and pick a shelf. Anything we can't read lands here first.")
                }
            } else {
                ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                    PileRow(item: item)
                        .padding(.bottom, Tokens.Space.sm)
                        .modifier(Reveal(index: i))
                }
            }
        }
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.xl)
    }

    // ── the bookcase ─────────────────────────────────────────────────────────

    /// One list, wrapped across as many boards as it needs. The column is
    /// SOLVED (`gridFor`), each row stands on a board that runs edge to edge,
    /// and empty boards are drawn down to the bottom of the viewport.
    @ViewBuilder private func bookcase(_ tab: String, _ items: [Item], quiet: Bool) -> some View {
        let gap = Tokens.Space.sm, above = Tokens.Space.xl
        let grid = DesignMath.gridFor(available: Double(viewport.width - inset * 2), gap: Double(gap))
        let rows = DesignMath.rowsOf(items.count, cols: grid.cols)
        let spare = DesignMath.emptyBoards(viewportH: Double(viewport.height),
                                           usedH: Double(max(rows.count, 1)) * DesignMath.rowPitch(gapAbove: Double(above)),
                                           pitch: DesignMath.emptyPitch(gapAbove: Double(above)))
        if items.isEmpty {
            if !quiet { emptyShelf(tab, width: CGFloat(grid.width)) }
        } else {
            ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                VStack(spacing: 0) {
                    // Bottom-aligned, so every trim rests on the board.
                    HStack(alignment: .bottom, spacing: gap) {
                        ForEach(row.map { items[$0] }) { item in
                            Press(Jacket.spoken(item), size: CGFloat(Jacket.trim(item).height), action: { nav.open = item }) {
                                Jacket(item: item, width: CGFloat(grid.width))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, inset)
                    .padding(.top, above)
                    BoardEdge()
                }
                .modifier(Reveal(index: r))
            }
        }
        // The rest of the case. A bookcase with room left is a bookcase; two
        // boards over a field of blank paper is a page that stopped.
        ForEach(0..<spare, id: \.self) { _ in
            Color.clear.frame(height: Tokens.Cover.emptyBoardH).padding(.top, above)
            BoardEdge()
        }
    }

    /// An outline of the thing that is missing, at the exact trim a real one
    /// would have, and what to do about it.
    private func emptyShelf(_ list: String, width: CGFloat) -> some View {
        let info = Lists.info(list)
        // What happens next differs by shelf.
        let words = list == "notes" ? "Tap Write to keep a note here."
            : list == "wishlist" ? "Share a shop page and pick Wishlist. The thing lands here with its price."
            : "Share a reel and pick \(info.label) — the \(info.one) lands here with a cover."
        return HStack(alignment: .bottom, spacing: Tokens.Space.md) {
            // Paper has no colour to outline with, so its ghost is drawn in ink.
            Rectangle().strokeBorder(theme.isPaper(list) ? theme.ink : theme.field(list), lineWidth: Tokens.coverKeyline)
                .frame(width: width, height: CGFloat(DesignMath.coverFor(list).height))
            emptyCopy("Nothing on this shelf", words)
        }
        .padding(.horizontal, inset)
        .padding(.top, Tokens.Space.xl)
    }

    /// DESIGN §7: a title, and a sentence saying what happens next.
    private func emptyCopy(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.xs) {
            Text(title).lineBox(T.section).foregroundStyle(theme.ink)
            Text(body).lineBox(T.meta).foregroundStyle(theme.inkSoft).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, Tokens.Space.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The staggered entrance of app/src/Reveal.tsx: opacity and a short rise off
/// one spring, capped at eight steps so a 200-item shelf enters in the same
/// time as an 8-item one. Under Reduce Motion there is NO motion, not less.
private struct Reveal: ViewModifier {
    var index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    /// 10pt, deliberately small: a row that flies in draws the eye to the
    /// animation and not to the thing.
    private static let rise: CGFloat = 10

    func body(content: Content) -> some View {
        let there = shown || reduceMotion
        content
            .opacity(there ? 1 : 0)
            .offset(y: there ? 0 : Reveal.rise)
            .onAppear {
                guard !shown else { return }
                let delay = Double(min(index, Tokens.staggerMaxSteps - 1)) * Tokens.staggerStep / 1000
                withAnimation(.interpolatingSpring(mass: Double(Tokens.Spring.enter.mass),
                                                   stiffness: Tokens.Spring.enter.stiffness,
                                                   damping: Tokens.Spring.enter.damping).delay(delay)) { shown = true }
            }
    }
}

#if DEBUG
/// The home screen on the bundled fixture (`Resources/Debug/shelf.json`, the
/// shelf the Expo shots show), in a scratch folder, with the network pointed
/// at nothing.
private struct HomePreview: View {
    @Environment(\.theme) private var theme
    @State private var model: AppModel
    @State private var nav: Nav

    init(tab: String) {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("shelf-preview-\(tab)", isDirectory: true)
        try? fm.removeItem(at: dir)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        if let src = Bundle.main.url(forResource: "shelf", withExtension: "json", subdirectory: "Debug")
            ?? Bundle.main.url(forResource: "shelf", withExtension: "json") {
            try? fm.copyItem(at: src, to: dir.appendingPathComponent("shelf.json"))
        }
        _model = State(initialValue: AppModel(directory: dir, api: API(base: URL(string: "http://127.0.0.1:9")!)))
        let nav = Nav()
        nav.tab = tab
        _nav = State(initialValue: nav)
    }

    var body: some View {
        Themed {
            ZStack {
                Backdrop()
                if model.ready { HomeScreen() }
            }
        }
        .environment(model)
        .environment(nav)
        .task { await model.boot() }
    }

    private struct Backdrop: View {
        @Environment(\.theme) private var theme
        var body: some View { theme.bg.ignoresSafeArea() }
    }
}

#Preview("Books, light") { HomePreview(tab: "books").preferredColorScheme(.light) }
#Preview("Books, dark") { HomePreview(tab: "books").preferredColorScheme(.dark) }
#Preview("Quotes, light") { HomePreview(tab: "quotes").preferredColorScheme(.light) }
#Preview("Wishlist, light") { HomePreview(tab: "wishlist").preferredColorScheme(.light) }
#Preview("Notes, dark") { HomePreview(tab: "notes").preferredColorScheme(.dark) }
#Preview("Not shelved, light") { HomePreview(tab: "unsorted").preferredColorScheme(.light) }
#endif
