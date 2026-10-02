// PileRow.swift — one thing that is not on a shelf yet. A port of `PileRow`
// and `whyUnread` in app/App.tsx.
//
// Flat rows, on purpose: a thing you have not filed is not standing anywhere,
// and the layout should say so before the label does.
import SwiftUI

enum Pile {
    /// Why this one has no name — different words per cause, because the thing
    /// you should do next differs. Nil when it has a name.
    static func whyUnread(_ item: Item) -> String? {
        if let t = item.title, !t.isEmpty { return nil }
        if let e = item.error, !e.isEmpty { return "It went wrong while reading: \(e)" }
        if item.resolver == "none" || (item.resolver ?? "").isEmpty {
            return "Instagram gave us nothing to read. Screenshot the reel and share the picture instead — that path never touches Instagram."
        }
        return "We got the caption but couldn't tell what it was about."
    }
}

struct PileRow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    let item: Item

    /// App.tsx `pileSwatch`: a 9pt square.
    private static let swatch: CGFloat = 9
    private static let edge: CGFloat = 2
    /// `bodyMed` asks for weight 600. Helvetica Neue has no such face and falls
    /// to Medium; the Expo shots show it bold.
    private static let title: TextStyle = { var s = T.bodyMed; s.weight = .bold; return s }()

    var body: some View {
        let pending = item.status == .pending
        let why = pending ? nil : Pile.whyUnread(item)
        // A pending item has no shelf yet. Painting it in a list colour is a
        // lie the eye reads before the words do: it gets an outline instead.
        let fill = theme.field(item.list)
        let named = !(item.title ?? "").isEmpty

        HStack(alignment: .top, spacing: Tokens.Space.sm) {
            // In a 44pt box, so the swatch lands on the FIRST LINE whether the
            // row is one line or five.
            Rectangle().strokeBorder(pending ? theme.inkFaint : fill, lineWidth: PileRow.edge)
                .background(pending ? Color.clear : fill)
                .frame(width: PileRow.swatch, height: PileRow.swatch)
                .frame(minHeight: Tokens.touchMin)

            // Openable even while it says it is working: a share that got
            // stuck must never be a dead end.
            Press(pending ? "Open the one still being read" : "Open \(named ? item.title! : "the one we couldn't read")",
                  size: Tokens.touchMin, action: { nav.open = item }) {
                VStack(alignment: .leading, spacing: Tokens.Space.xs) {
                    Text(pending ? "Working it out…" : (named ? item.title! : "Couldn't read this one"))
                        .lineBox(PileRow.title).foregroundStyle(theme.ink).lineLimit(1)
                    // The reason, in full. One line of it would be decoration.
                    if let why {
                        Text(why).lineBox(T.meta).foregroundStyle(theme.inkSoft)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, Tokens.Space.sm)
                .frame(maxWidth: .infinity, minHeight: Tokens.touchMin, alignment: .leading)
            }

            if pending {
                action("Reading")
            } else if why != nil {
                // Shelving a thing with no name puts a blank jacket on a board.
                Press("Try reading it again", size: Tokens.touchMin, action: { Task { await model.retry(item) } }) { action("Read again") }
            } else if item.status == .filed {
                // Read, named, and on no shelf: opening it is where it is moved.
                Press("Open \(item.title ?? "it")", size: Tokens.touchMin, action: { nav.open = item }) { action("Open →") }
            } else {
                Press("Shelve it", size: Tokens.touchMin, action: { model.edit(item, ItemEdit(file: true)) }) { action("Shelve →") }
            }
        }
        .padding(.horizontal, Tokens.Space.md)
        .padding(PileRow.edge)
        .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: PileRow.edge))
    }

    private func action(_ title: String) -> some View {
        Text(title).lineBox(T.micro).foregroundStyle(theme.inkFaint).fixedSize()
            .padding(.leading, Tokens.Space.sm)
            .frame(minHeight: Tokens.touchMin)
    }
}
