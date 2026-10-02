// ShareSheetScreen.swift — handing part of yourself to someone.
//
// A port of app/src/ShareSheet.tsx. ONE verb: a link anyone can open.
//
// THIS SCREEN IS THE ONLY PLACE ANYTHING LEAVES THE DEVICE. Opening it uploads
// a frozen snapshot of exactly what you are sharing — this item, or this
// shelf, or your card — and nothing else. Turning the link off deletes it.
//
// The panel is the list's own colour at full bleed — the same field the jacket
// and the item page use — so sharing a red thing happens on red. It is the
// last screen before something of yours leaves your phone, and it should feel
// like the thing, not like a system dialog.
import SwiftUI
import UIKit

private enum M {
    static let border: CGFloat = 2
    static let noteMax = 200
}

struct ShareSheetScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    let sharing: Sharing

    @State private var code: String?
    @State private var error: String?
    @State private var note = ""
    @State private var copied = false
    @State private var share: ShareItems?

    private var listKey: String { sharing.list ?? sharing.item?.list ?? "unsorted" }
    private var on: Color { theme.on(listKey) }
    private var fill: Color { theme.field(listKey) }
    private var url: URL? { code.map { model.api.shareURL(code: $0) } }

    private var kicker: String {
        switch sharing.kind {
        case .profile: return "Share your shelves"
        case .shelf: return "Share the \(Lists.info(sharing.list).label) shelf"
        case .item: return "Share this"
        }
    }

    var body: some View {
        // A scroll view, so the one field here gives way to the keyboard on a
        // short phone. Nothing scrolls when everything fits.
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Micro(kicker, color: on)
                    Spacer(minLength: Tokens.Space.md)
                    TextAction(title: "Close", color: on) { nav.sharing = nil }
                }
                Rule(color: on).padding(.top, Tokens.Space.md).padding(.bottom, Tokens.Space.lg)

                Text(sharing.title).style(T.itemTitle).foregroundStyle(on).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, Tokens.Space.lg)

                // An empty field must READ as empty. Set in the full label
                // colour, the placeholder looked like something already typed.
                TextField("", text: $note, prompt: Text("Say something about it (optional)").foregroundStyle(theme.ghost(on: listKey)))
                    .style(T.bodyMed).foregroundStyle(on).tint(on)
                    .padding(.horizontal, Tokens.Space.md)
                    .frame(minHeight: Tokens.touchMin)
                    .overlay(Rectangle().strokeBorder(on, lineWidth: M.border))
                    .padding(.top, Tokens.Space.sm)
                    .onChange(of: note) { _, now in if now.count > M.noteMax { note = String(now.prefix(M.noteMax)) } }
                    .accessibilityLabel("Say something about it, optional")

                // Three different states, three different renderings. A
                // spinner, a real address, and a reason it failed are not
                // interchangeable.
                if let error {
                    Text(error).style(T.meta).foregroundStyle(on)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, Tokens.Space.sm)
                } else if let url {
                    Text(url.absoluteString).style(T.bodyMed).foregroundStyle(on).lineLimit(2)
                        .textSelection(.enabled)
                        .padding(.top, Tokens.Space.md)
                } else {
                    ProgressView().tint(on)
                        .padding(.top, Tokens.Space.md)
                        .accessibilityLabel("Making the link")
                }

                Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                    ShelfButton(title: "Share link →", kind: .fill, on: on, field: fill, disabled: url == nil, label: "Share the link") {
                        guard let url else { return }
                        // The OS sheet already has Messages, Mail and
                        // everything else the person has installed.
                        share = ShareItems(items: note.isEmpty ? [url] : [note, url])
                    }
                    if let url {
                        ShelfButton(title: copied ? "Copied" : "Copy link", on: on, field: fill, label: copied ? "Link copied" : "Copy the link") {
                            UIPasteboard.general.url = url
                            copied = true
                        }
                    }
                    if let code {
                        ShelfButton(title: "Turn it off", on: on, field: fill, label: "Turn this link off") {
                            Task {
                                await model.revoke(code)
                                nav.sharing = nil
                            }
                        }
                    }
                }
                .padding(.top, Tokens.Space.lg)

                Rule(color: on).padding(.top, Tokens.Space.xl).padding(.bottom, Tokens.Space.lg)
                Text("Everything else stays on your phone. This link is the only copy that leaves it, and turning it off deletes that copy.")
                    .style(T.meta).foregroundStyle(on)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Tokens.Space.sm)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Tokens.Space.lg)
            .padding(.top, Tokens.Space.xxl - Tokens.Space.lg)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background(fill.ignoresSafeArea())
        // THE SNAPSHOT IS BUILT AND UPLOADED WHEN THE PANEL OPENS, not when
        // you press a button. By the time you decided to share something you
        // had already decided. Built once: rebuilding it as the shelf changes
        // underneath would publish something the person never looked at.
        .task { await publish() }
        .shareSheet($share)
    }

    private func publish() async {
        guard code == nil, error == nil else { return }
        do {
            let link = try await model.publish(Self.snapshot(sharing, shelf: model.shelf),
                                               kind: sharing.kind.rawValue,
                                               target: sharing.kind == .shelf ? listKey : nil,
                                               title: sharing.title)
            code = link.code
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// WHAT GOES UP — only what is named here. A single item sends that item;
    /// a shelf sends that shelf; a card sends the shelves and your name. Your
    /// notes travel with the thing they are about, and nothing else is
    /// included. (api/publish.js keeps only the fields it names.)
    static func snapshot(_ sharing: Sharing, shelf: Shelf) -> [String: JSONValue] {
        let listKey = sharing.list ?? sharing.item?.list ?? "unsorted"
        let p = shelf.profile
        var body: [String: JSONValue] = [
            "kind": .string(sharing.kind.rawValue),
            "owner": .object(["name": .string(p.name), "bio": .string(p.bio), "seed": .string(p.seed)]),
        ]
        switch sharing.kind {
        case .item:
            body["item"] = sharing.item.map(json) ?? .null
        case .shelf:
            body["target"] = .string(listKey)
            body["items"] = .array(Store.shelfOf(shelf, listKey).map(json))
        case .profile:
            // EVERY shelf, from the one list of shelves — written out by hand
            // it stayed at four when two more shipped, and a card silently
            // left them out.
            //
            // …EXCEPT NOTES, and that is a decision, not an oversight. A note
            // is something you wrote to yourself — "ask the landlord about the
            // boiler" — and "share your shelves" is not a request to publish
            // those. One note can still be shared from its own page, on purpose.
            var lists: [String: JSONValue] = [:]
            for l in Lists.shelves where l.key != "notes" {
                lists[l.key] = .array(Store.shelfOf(shelf, l.key).map(json))
            }
            assert(lists["notes"] == nil && lists.count == Lists.shelves.count - 1, "a card is every shelf but Notes")
            body["lists"] = .object(lists)
        }
        return body
    }

    /// An item as the JSON the file holds (`image_url`, `source_url`, …).
    private static func json(_ item: Item) -> JSONValue {
        guard let data = try? JSONEncoder().encode(item),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return value
    }
}

#if DEBUG
#Preview("Share a shelf") {
    FixturePreviewHost { _ in ShareSheetScreen(sharing: Sharing(kind: .shelf, list: "books", title: "Your books shelf")) }
}
#Preview("Share the card, dark") {
    FixturePreviewHost { _ in ShareSheetScreen(sharing: Sharing(kind: .profile, title: "Your whole card")) }
        .preferredColorScheme(.dark)
}
#Preview("Share an item") {
    FixturePreviewHost { model in
        if let it = model.item("movies-0") {
            ShareSheetScreen(sharing: Sharing(kind: .item, item: it, list: it.list, title: it.title ?? "This one"))
        }
    }
}
#endif
