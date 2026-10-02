// ListsScreen.swift — your own lists: an outfit, a trip, gifts for somebody.
//
// A port of app/src/ListsScreen.tsx. The shelves are what a thing IS. A list
// is what it is FOR, and one thing can be for several. A wishlist is a list
// whose things have prices; a moodboard is a list looked at as pictures. They
// are the same object with two views, which is why this is one screen.
//
// The logic is `ListsLogic`, which is tested line by line. This file only
// draws, and every change goes through `model.setBoards(ListsLogic.…)`.
// One screen, three states — the index, one list open, and "add this item to
// a list" — because each is the one before with something picked.
//
// Paper: file "shelf" → "Boards" (the index; the word on screen is Lists),
// "List open — moodboard (pictures)", "List open — rows with prices and a
// total", "Add to a list — from an item".
import SwiftUI

struct ListsScreen: View {
    @Environment(Nav.self) private var nav
    /// Starts on `nav.listStart`; "add to a list" when `nav.listAdding` is set.
    var body: some View { ListsBody(start: nav.listStart) }
}

// EVERYTHING is a list nobody made: all of it, as pictures. It is not stored —
// a row in the file that says "all items" would be a second source of truth
// for something the items array already is.
private let everythingId = "*"

private func two(_ n: Int) -> String { String(format: "%02d", n) }

// A tile's height comes from its id, so a board keeps its shape between
// launches instead of reshuffling. Four steps on the 4pt grid.
private let tileHeights: [CGFloat] = [152, 184, 212, 240]
private func heightOf(_ id: String) -> CGFloat {
    var h: UInt32 = 0
    for unit in id.utf16 { h = h &* 31 &+ UInt32(unit) }
    return tileHeights[Int(h % UInt32(tileHeights.count))]
}

/// Two columns, each new tile on the shorter one.
private func columns(_ items: [Item]) -> [[Item]] {
    var cols: [[Item]] = [[], []]
    var tall: [CGFloat] = [0, 0]
    for it in items {
        let c = tall[0] <= tall[1] ? 0 : 1
        cols[c].append(it)
        tall[c] += heightOf(it.id)
    }
    return cols
}

private struct ListsBody: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    @State private var open: String?
    @State private var allView: Board.View = .pictures
    @State private var name = ""
    @State private var picking = false
    @State private var busy = false
    @State private var chosen = 0
    @State private var said: String?

    init(start: String?) { _open = State(initialValue: start) }

    private static let boardName = TextStyle(step: Tokens.Text.heading, weight: .bold, size: T.band.resolvedSize - 6,
                                             lineHeight: T.band.resolvedSize, tracking: T.itemTitle.resolvedTracking)
    // The React Native `priceSlot` width.
    private let priceSlot: CGFloat = 76
    private let bigButton = Tokens.touchMin + 8

    private var boards: [Board] { model.shelf.boards }
    private var filed: [Item] { model.items.filter { $0.status == .filed } }
    private func everything() -> Board { Board(id: everythingId, name: "Everything", view: allView) }
    private func members(of b: Board) -> [Item] { b.id == everythingId ? filed : ListsLogic.items(of: b, in: model.items) }

    var body: some View {
        Group {
            if let adding = nav.listAdding {
                addTo(model.item(adding.id) ?? adding)
            } else if let list = open == everythingId ? everything() : boards.first(where: { $0.id == open }) {
                one(list)
            } else {
                index
            }
        }
        .background(theme.bg.ignoresSafeArea())
    }

    // ── the index ────────────────────────────────────────────────────────────

    private var index: some View {
        VStack(spacing: 0) {
            ScreenHead(title: "Lists") { TextAction(title: "Close") { nav.close() } }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("A list is for anything: an outfit, a trip, gifts. Put saved things, pictures and notes on it.")
                        .rowLine(T.body).foregroundStyle(theme.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Tokens.Space.lg)
                        .padding(.top, Tokens.Space.lg)

                    ForEach([everything()] + boards) { b in boardRow(b) }

                    VStack(alignment: .leading, spacing: Tokens.Space.sm) {
                        Micro("New list", color: theme.inkSoft)
                        newRow(pin: nil)
                    }
                    .padding(.horizontal, Tokens.Space.lg)
                    .padding(.top, Tokens.Space.xxl)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Tokens.Space.sm)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    /// One list, standing on a board: its name, what it finds and comes to,
    /// the shelf mix, and how many.
    private func boardRow(_ b: Board) -> some View {
        let mine = members(of: b)
        let sum = ListsLogic.shelfTotal(mine).byCurrency.map(\.text).joined(separator: " + ")
        let line = [b.query.map { "Finds “\($0)”" }, sum.isEmpty ? nil : sum].compactMap { $0 }.joined(separator: " · ")
        // The shelf mix: how much of the list is which colour. One glance says
        // "mostly restaurants", which a count cannot. Shelves in the order
        // they are first met, most first, five at the most.
        var order: [String] = [], count: [String: Int] = [:]
        for it in mine { if count[it.list] == nil { order.append(it.list) }; count[it.list, default: 0] += 1 }
        let mix = order.enumerated().map { (at: $0.offset, list: $0.element, n: count[$0.element] ?? 0) }
            .sorted { $0.n != $1.n ? $0.n > $1.n : $0.at < $1.at }.prefix(5)

        return Press("\(b.name), \(mine.count) things", size: Tokens.touchMin + 40, action: { open = b.id }) {
            VStack(spacing: 0) {
                HStack(alignment: .bottom, spacing: Tokens.Space.md) {
                    VStack(alignment: .leading, spacing: Tokens.Space.xs) {
                        Text(b.name).style(Self.boardName).foregroundStyle(theme.ink).lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        if !line.isEmpty { Micro(line, color: theme.inkSoft).monospacedDigit().lineLimit(1) }
                        if !mix.isEmpty {
                            GeometryReader { g in
                                // 70% of the text column; 2pt between bars.
                                let total = CGFloat(mix.reduce(0) { $0 + $1.n })
                                let room = g.size.width * 0.7 - 2 * CGFloat(mix.count - 1)
                                HStack(spacing: 2) {
                                    ForEach(Array(mix), id: \.list) { m in
                                        theme.field(m.list)
                                            // A paper bar on paper is a gap, and a gap reads
                                            // as "nothing here" in a bar that shows shares.
                                            .overlay(theme.isPaper(m.list) ? Rectangle().strokeBorder(theme.ink, lineWidth: Tokens.hairline) : nil)
                                            .frame(width: max(0, room * CGFloat(m.n) / max(total, 1)))
                                    }
                                }
                            }
                            .frame(height: Tokens.Space.sm)
                            .padding(.top, Tokens.Space.xs)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(two(mine.count)).style(T.detailTitle).monospacedDigit().foregroundStyle(theme.ink)
                }
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.bottom, Tokens.Space.md)
                BoardEdge()
            }
        }
        .padding(.top, Tokens.Space.xl)
    }

    /// The name field and "Make →". Two things that are proven to fit one
    /// line at 320pt: the field's floor is 160 and the button is about 90.
    private func newRow(pin item: Item?) -> some View {
        HStack(spacing: Tokens.Space.sm) {
            InkField(placeholder: "A name for it", text: $name)
                .submitLabel(.done)
                .onSubmit { make(thenPin: item) }
                .onChange(of: name) { _, now in
                    if now.count > ListsLogic.nameMax { name = String(now.prefix(ListsLogic.nameMax)) }
                }
                .frame(minWidth: 160)
            // No name makes no list: the button does nothing, and does not go
            // grey (it does not in the Expo app either).
            ShelfButton(title: "Make →", kind: .fill, label: item == nil ? "Make the list" : "Make the list and add it",
                        minHeight: bigButton) { make(thenPin: item) }
        }
    }

    private func make(thenPin item: Item?) {
        guard let b = ListsLogic.make(name: name) else { return }
        let next = [b] + boards
        model.setBoards(item.map { ListsLogic.pin(next, id: b.id, itemId: $0.id) } ?? next)
        name = ""
        if item == nil { open = b.id }
    }

    // ── "Add this to a list" ─────────────────────────────────────────────────

    private func addTo(_ adding: Item) -> some View {
        let on = Set(ListsLogic.lists(boards, with: adding.id).map(\.id))
        let pickName = TextStyle(step: Tokens.Text.bodyMed, weight: .bold)
        return VStack(spacing: 0) {
            // Back to the item it was opened from.
            ScreenHead(kicker: adding.title ?? "This one", title: "Add to a list") {
                TextAction(title: "Done") { nav.show(model.item(adding.id) ?? adding) }
            }
            .lineLimit(1)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(boards) { b in
                        let has = on.contains(b.id)
                        Press(has ? "Take off \(b.name)" : "Add to \(b.name)", size: Tokens.touchMin + 12,
                              action: { model.setBoards(ListsLogic.togglePin(boards, id: b.id, itemId: adding.id)) }) {
                            HStack(spacing: Tokens.Space.md) {
                                Text(b.name).style(pickName).foregroundStyle(has ? theme.bg : theme.ink).lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Micro(has ? "On it" : "Add", color: has ? theme.bg : theme.inkSoft)
                            }
                            .modifier(InkBox(minHeight: Tokens.touchMin + 12, fill: has ? theme.ink : nil))
                        }
                        .padding(.top, Tokens.Space.sm)
                    }
                    Micro("New list", color: theme.inkSoft).padding(.top, Tokens.Space.xl)
                    newRow(pin: adding).padding(.top, Tokens.Space.sm)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.top, Tokens.Space.sm)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    // ── one list, open ───────────────────────────────────────────────────────

    private func one(_ list: Board) -> some View {
        let items = members(of: list)
        let total = ListsLogic.shelfTotal(items)
        let money = total.byCurrency.map(\.text).joined(separator: " + ")
        // "No price" is a fact about a THING TO BUY. A book or a note on the
        // same list is not missing a price, so it is not counted as one that is.
        let unpriced = items.filter { $0.kind == "product" && ListsLogic.priceOn($0) == nil }.count
        let count = "\(two(items.count)) \(items.count == 1 ? "thing" : "things")"
            + (list.view == .pictures && !money.isEmpty ? " · \(money)" : "")

        return VStack(spacing: 0) {
            ScreenHead(kicker: "List", title: list.name) {
                HStack(spacing: Tokens.Space.lg) {
                    TextAction(title: "All lists") { open = nil }
                    TextAction(title: "Close") { nav.close() }
                }
            }

            // The switch and the count: side by side when they fit, the count
            // under the switch when they do not (320pt with a total).
            let switcher = HStack(spacing: 0) {
                ForEach(ListsLogic.views, id: \.self) { v in
                    Press("Show as \(v.rawValue)", size: Tokens.touchMin, action: { flip(list, v) }) {
                        Text(v.rawValue).style(T.micro).foregroundStyle(list.view == v ? theme.bg : theme.ink)
                            .modifier(InkBox(fill: list.view == v ? theme.ink : nil))
                    }
                    .accessibilityAddTraits(list.view == v ? .isSelected : [])
                }
            }
            let counted = Text(count).style(T.micro).monospacedDigit().foregroundStyle(theme.inkSoft).lineLimit(1)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Tokens.Space.sm) { switcher; Spacer(minLength: 0); counted }
                VStack(alignment: .leading, spacing: Tokens.Space.sm) { switcher; counted }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.vertical, Tokens.Space.md)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if items.isEmpty {
                        // A title, what happens next, a way forward (below).
                        VStack(alignment: .leading, spacing: Tokens.Space.xs) {
                            Text("Nothing on this list yet").style(T.section).foregroundStyle(theme.ink)
                            Text("Open anything you have saved and tap Add to a list. Or add pictures and notes here.")
                                .rowLine(T.body).foregroundStyle(theme.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                        .padding(.top, Tokens.Space.xl)
                    } else if list.view == .pictures {
                        HStack(alignment: .top, spacing: Tokens.Space.sm) {
                            ForEach(Array(columns(items).enumerated()), id: \.offset) { _, col in
                                VStack(spacing: Tokens.Space.sm) {
                                    ForEach(col) { item in Tile(item: item) { nav.show(item) } }
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(items) { item in
                                Press("\(item.title ?? "Not read yet"), \(Lists.info(item.list).label)",
                                      size: Tokens.touchMin + 20, action: { nav.show(item) }) {
                                    ItemRow(list: item.list, title: item.title ?? "Not read yet", subtitle: item.subtitle, slot: priceSlot) {
                                        if let price = ListsLogic.priceOn(item) {
                                            Text(price).style(TextStyle(step: Tokens.Text.bodyMed, weight: .bold))
                                                .monospacedDigit().foregroundStyle(theme.ink).lineLimit(1)
                                        }
                                    }
                                }
                                .padding(.top, Tokens.Space.sm)
                            }
                            // One line per currency. Pounds and dollars are
                            // never added together.
                            if total.priced > 0 {
                                Rule().padding(.top, Tokens.Space.xl)
                                HStack(alignment: .bottom, spacing: Tokens.Space.md) {
                                    VStack(alignment: .leading, spacing: Tokens.Space.xs) {
                                        Micro("Total")
                                        Text("\(total.priced) with a price." + (unpriced > 0 ? " \(unpriced) with no price." : ""))
                                            .rowLine(T.meta).monospacedDigit().foregroundStyle(theme.inkSoft)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    VStack(alignment: .trailing, spacing: 0) {
                                        ForEach(total.byCurrency, id: \.currency) { m in
                                            Text(m.text).style(T.detailTitle).monospacedDigit().foregroundStyle(theme.ink)
                                        }
                                    }
                                }
                                .padding(.top, Tokens.Space.md)
                            }
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                    }

                    Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                        ShelfButton(title: "Add pictures →", kind: .fill, busy: busy, label: "Add pictures", minHeight: bigButton) { picking = true }
                        ShelfButton(title: "Write a note", minHeight: bigButton) {
                            // A note stands on the Notes shelf AND on this list.
                            nav.writingFor = list.id == everythingId ? nil : list.id
                            nav.writing = true
                        }
                        if list.id != everythingId {
                            ShelfButton(title: "Delete list", label: "Delete the list \(list.name)", minHeight: bigButton) {
                                model.setBoards(ListsLogic.remove(boards, id: list.id))
                                open = nil
                            }
                        }
                    }
                    .padding(.horizontal, Tokens.Space.lg)
                    .padding(.top, Tokens.Space.xl)

                    if let said {
                        Text(said).rowLine(T.meta).foregroundStyle(theme.accent)
                            .padding(.horizontal, Tokens.Space.lg)
                            .padding(.top, Tokens.Space.md)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Tokens.Space.sm)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
        }
        .sheet(isPresented: $picking) {
            // Pictures from the camera roll, kept, and pinned to the open list.
            PhotoPick(limit: 12, onChosen: { n in
                picking = false
                busy = n > 0
                chosen = n
                said = nil
            }, onData: { datas in
                let before = model.items.count
                model.addPictures(datas, pinTo: list.id == everythingId ? nil : list.id)
                // Fewer on the shelf than were picked: say so, do not hide it.
                let lost = chosen - (model.items.count - before)
                if lost > 0 { said = lost == 1 ? "One picture could not be kept." : "\(lost) pictures could not be kept." }
                busy = false
            })
            .ignoresSafeArea()
        }
    }

    private func flip(_ list: Board, _ v: Board.View) {
        if list.id == everythingId { allView = v }
        else { model.setBoards(ListsLogic.setView(boards, id: list.id, view: v)) }
    }
}

/// One thing on a moodboard: its picture, or a jacket of type when it has
/// none. A note is a paper tile holding its own words.
private struct Tile: View {
    @Environment(\.theme) private var theme
    var item: Item
    var onOpen: () -> Void

    private let floor = Tokens.touchMin + 60
    private static let title = TextStyle(step: Tokens.Text.bodyMed, weight: .bold)
    private static let tag = TextStyle(step: Tokens.Text.meta, weight: .bold)

    var body: some View {
        let note = item.kind == "note"
        let fill = note ? theme.bg : theme.field(item.list)
        let on = note ? theme.ink : theme.on(item.list)
        let keyline = Tokens.coverKeyline
        let words = Text(note ? (item.note.isEmpty ? (item.title ?? "") : item.note) : (item.title ?? "Not read yet"))
            .rowLine(note ? T.body : Self.title)
            .foregroundStyle(on)
            .lineLimit(note ? 8 : 4)
            .multilineTextAlignment(.leading)
            .padding(Tokens.Space.sm)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

        Press("Open \(item.title ?? "it")", size: floor, action: onOpen) {
            ZStack(alignment: .bottomLeading) {
                if let art = item.imageURL, !art.isEmpty { RowArt(url: art) { words } } else { words }
                // The price sits on paper, not on the picture: a number over a
                // photograph is a contrast ratio nobody computed.
                if let price = ListsLogic.priceOn(item) {
                    Text(price).rowLine(Self.tag).monospacedDigit().foregroundStyle(theme.ink)
                        .padding(.leading, Tokens.Space.sm)
                        .padding(.trailing, Tokens.Space.sm + keyline)
                        .padding(.bottom, Tokens.Space.xs)
                        .padding(.top, Tokens.Space.xs + keyline)
                        .background(theme.bg)
                        .overlay(alignment: .top) { theme.ink.frame(height: keyline) }
                        .overlay(alignment: .trailing) { theme.ink.frame(width: keyline) }
                }
            }
            // A note is as tall as its words; everything else as tall as its
            // id says. Both include the 2pt keyline, as a border-box does.
            .frame(minHeight: floor - keyline * 2)
            .frame(height: note ? nil : heightOf(item.id) - keyline * 2)
            .frame(maxWidth: .infinity)
            .background(fill)
            .clipped()
            .padding(keyline)
            .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: keyline))
        }
    }
}

#if DEBUG
#Preview("Lists") { FixtureStage { ListsScreen() } }
#Preview("Lists, dark") { FixtureStage { ListsScreen() }.preferredColorScheme(.dark) }
#Preview("Pictures") { FixtureStage({ $0.listStart = "l-outfit" }) { ListsScreen() } }
#Preview("Everything") { FixtureStage({ $0.listStart = "*" }) { ListsScreen() } }
#Preview("Add to a list") { FixtureStage({ $0.screen = .lists; $0.pendingAdding = "books-0" }) { ListsScreen() } }
#endif
