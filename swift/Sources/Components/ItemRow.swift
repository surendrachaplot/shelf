// ItemRow.swift — the bordered row Find, Add, Tags and Lists all draw.
//
// One component, because three copies would drift: the shelf's colour block
// with its plate number, a title, a subtitle, an optional third line that says
// WHY the row is here, and an optional trailing slot. The values are the
// React Native `row / block / rowMain / priceSlot` styles, one for one.
//
// Also here, because the same screens need them and nothing else does: the
// ink-outlined box (`InkBox`), a picture with its designed fallback (`RowArt`)
// and the fixture stage the previews stand on.
import SwiftUI
import UIKit

extension View {
    /// `.style` plus the step's LINE HEIGHT as a floor. SwiftUI sets one line
    /// of 15pt in about 18pt; the design says 22. Without this every row is
    /// 4pt short per line against the Expo app.
    func rowLine(_ s: TextStyle) -> some View { style(s).frame(minHeight: s.resolvedLine) }
}

/// React Native's bordered control box: `minHeight`, `paddingHorizontal` and a
/// `borderWidth` that sits INSIDE the box. Radius zero; a field is this too.
struct InkBox: ViewModifier {
    @Environment(\.theme) private var theme
    var pad: CGFloat = Tokens.Space.md
    var border: CGFloat = Tokens.coverKeyline
    var minHeight: CGFloat = Tokens.touchMin
    var fill: Color? = nil

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, pad + border)
            .frame(minHeight: minHeight)
            .background(fill ?? Color.clear)
            .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: border))
    }
}

/// A picture that survives its own failure (DESIGN: a designed fallback for
/// missing AND failed). It takes the size it is GIVEN — a bare resizable
/// image would report the photo's own size and blow a row up to it.
struct RowArt<Fallback: View>: View {
    var url: String?
    @ViewBuilder var fallback: () -> Fallback

    var body: some View {
        Color.clear.overlay { picture }.clipped()
    }

    @ViewBuilder private var picture: some View {
        if let s = url, !s.isEmpty, let u = URL(string: s) {
            if u.isFileURL {
                // A kept picture is a small JPEG next to the shelf file.
                // ponytail: decoded on every draw; cache by path if a board of
                // a hundred pictures ever scrolls badly.
                if let image = UIImage(contentsOfFile: u.path) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else { fallback() }
            } else {
                AsyncImage(url: u) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { fallback() }
                }
            }
        } else { fallback() }
    }
}

struct ItemRow<Trailing: View>: View {
    @Environment(\.theme) private var theme
    var list: String
    var title: String
    var subtitle: String? = nil
    /// Why this row is here, when the title does not say ("your note: …").
    var third: String? = nil
    /// A cover. With one the shelf colour is a 6pt edge and the cover takes
    /// the rest of the block; without one the block is all colour.
    var art: String? = nil
    /// Find and Add: semibold title, fainter subtitle, tighter text box.
    var compact = false
    /// A FIXED trailing width, filled or not, so every price down a list ends
    /// on the same right-hand edge.
    var slot: CGFloat? = nil
    @ViewBuilder var trailing: () -> Trailing

    // The React Native numbers: `rowEdge` 6, `thumb` 44, `block` 44 + 6.
    private let edge: CGFloat = 6
    private static var bold: TextStyle { TextStyle(step: Tokens.Text.bodyMed, weight: .bold) }

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 0) {
                theme.field(list).frame(width: edge)
                RowArt(url: art) {
                    ZStack {
                        theme.field(list)
                        Text(Lists.info(list).n).style(T.tag).monospacedDigit().foregroundStyle(theme.on(list))
                    }
                }
                .frame(width: Tokens.touchMin)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 0) {
                Text(title).rowLine(compact ? T.bodyMed : Self.bold).foregroundStyle(theme.ink).lineLimit(2)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).rowLine(T.meta).foregroundStyle(compact ? theme.inkFaint : theme.inkSoft)
                        .lineLimit(1).padding(.top, 2)
                }
                if let third, !third.isEmpty {
                    Text(third).rowLine(T.meta).foregroundStyle(theme.inkSoft)
                        .lineLimit(2).padding(.top, Tokens.Space.xs)
                }
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, Tokens.Space.md)
            .padding(.vertical, compact ? Tokens.Space.sm : Tokens.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let slot {
                trailing().padding(.trailing, Tokens.Space.md).frame(width: slot, alignment: .trailing)
            } else {
                trailing()
            }
        }
        // 2pt of border INSIDE a 64pt floor, as a border-box has it.
        .frame(minHeight: Tokens.touchMin + 20 - Tokens.coverKeyline * 2)
        .padding(Tokens.coverKeyline)
        .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: Tokens.coverKeyline))
    }
}

extension ItemRow where Trailing == EmptyView {
    init(list: String, title: String, subtitle: String? = nil, third: String? = nil, art: String? = nil, compact: Bool = false) {
        self.init(list: list, title: title, subtitle: subtitle, third: third, art: art, compact: compact, slot: nil) { EmptyView() }
    }
}

#if DEBUG
/// What a preview stands on: the bundled fixture shelf in a scratch folder,
/// with the network pointed at nothing. Never the real shelf.json.
struct FixtureStage<Content: View>: View {
    @State private var model: AppModel
    @State private var nav: Nav
    private let content: () -> Content

    init(_ setup: (Nav) -> Void = { _ in }, @ViewBuilder content: @escaping () -> Content) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-preview-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let src = Bundle.main.url(forResource: "shelf", withExtension: "json", subdirectory: "Debug")
            ?? Bundle.main.url(forResource: "shelf", withExtension: "json") {
            try? FileManager.default.copyItem(at: src, to: dir.appendingPathComponent("shelf.json"))
        }
        let nav = Nav()
        setup(nav)
        _model = State(initialValue: AppModel(directory: dir, api: API(base: URL(string: "http://127.0.0.1:9")!)))
        _nav = State(initialValue: nav)
        self.content = content
    }

    var body: some View {
        Themed { ZStack { if model.ready { content() } } }
            .environment(model)
            .environment(nav)
            .task { await model.boot(); nav.applyPending(model) }
    }
}

#Preview("Rows") {
    Themed {
        VStack(spacing: Tokens.Space.sm) {
            ItemRow(list: "restaurants", title: "Ganapati", subtitle: "38 Holly Grove, Peckham · Restaurants",
                    third: "your note: Get the dosa. Go early, they don't take bookings after 7", compact: true)
            ItemRow(list: "wishlist", title: "Wool overshirt, olive", subtitle: "Northfield", slot: 76) {
                Text("£65").style(T.bodyMed).fontWeight(.bold).monospacedDigit()
            }
            ItemRow(list: "notes", title: "Brown boots, not black.", slot: 76) { EmptyView() }
        }
        .padding(Tokens.Space.lg)
    }
}
#endif
