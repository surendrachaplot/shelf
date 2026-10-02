// Chrome.swift — the small pieces every screen is built from.
//
// Everything caps-and-tracked is chrome; only item titles are not. Radius is
// zero everywhere. A control takes its NATURAL width and a fixed minimum
// height — never the full width of the screen.
import SwiftUI

/// The 11pt caps-and-tracked label.
struct Micro: View {
    @Environment(\.theme) private var theme
    var text: String
    var color: Color? = nil
    init(_ text: String, color: Color? = nil) { self.text = text; self.color = color }
    var body: some View { Text(text).style(T.micro).foregroundStyle(color ?? theme.ink) }
}

/// A 3pt section rule, ink.
struct Rule: View {
    @Environment(\.theme) private var theme
    var color: Color? = nil
    var height: CGFloat = Tokens.rule
    var body: some View { (color ?? theme.ink).frame(height: height).frame(maxWidth: .infinity) }
}

/// The shelf a cover stands on: a hard edge with thickness. Depth in this
/// system is a BOARD, never a shadow.
struct BoardEdge: View {
    @Environment(\.theme) private var theme
    var height: CGFloat = Tokens.board
    var body: some View { theme.ink.frame(height: height).frame(maxWidth: .infinity) }
}

enum ButtonKind { case fill, ghost }

/// Ink-filled or ink-outlined, natural width, 44pt floor.
struct ShelfButton: View {
    @Environment(\.theme) private var theme
    var title: String
    var kind: ButtonKind = .ghost
    /// Colours when the button sits on a shelf's field rather than on paper.
    var on: Color? = nil
    var field: Color? = nil
    var busy = false
    var disabled = false
    var label: String? = nil
    var minHeight: CGFloat = Tokens.touchMin
    var action: () -> Void

    var body: some View {
        let ink = on ?? theme.ink
        let paper = field ?? theme.bg
        Press(label ?? title, size: minHeight, disabled: disabled || busy, action: action) {
            ZStack {
                if busy { ProgressView().tint(kind == .fill ? paper : ink) }
                else { Text(title).style(T.micro).foregroundStyle(kind == .fill ? paper : ink) }
            }
            .padding(.horizontal, Tokens.Space.lg)
            .frame(minHeight: minHeight)
            .background(kind == .fill ? ink : Color.clear)
            .overlay(Rectangle().strokeBorder(ink, lineWidth: kind == .ghost ? 2 : 0))
            .opacity(disabled ? 0.5 : 1)
        }
    }
}

/// A text-only control (CLOSE, ALL TAGS) with a 44pt box.
struct TextAction: View {
    @Environment(\.theme) private var theme
    var title: String
    var color: Color? = nil
    var label: String? = nil
    var action: () -> Void
    var body: some View {
        Press(label ?? title, size: Tokens.touchMin, action: action) {
            Text(title).style(T.micro).foregroundStyle(color ?? theme.ink)
                .frame(minHeight: Tokens.touchMin)
        }
    }
}

/// The top of an overlay screen: an optional kicker, a big title, actions on
/// the right, and the rule under it. Used by Find, Tags, Lists, the card.
struct ScreenHead<Actions: View>: View {
    @Environment(\.theme) private var theme
    var kicker: String? = nil
    var title: String
    var style: TextStyle = T.detailTitle
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: Tokens.Space.lg) {
                VStack(alignment: .leading, spacing: 0) {
                    if let kicker { Micro(kicker, color: theme.inkSoft) }
                    Text(title).style(style).foregroundStyle(theme.ink).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                actions()
            }
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.xl)
            .padding(.bottom, Tokens.Space.md)
            Rule()
        }
    }
}

/// A shelf's colour block carrying its plate number: the left edge of a row.
struct ShelfBlock: View {
    @Environment(\.theme) private var theme
    var list: String
    var width: CGFloat = Tokens.touchMin + 6
    var body: some View {
        ZStack {
            theme.field(list)
            Text(Lists.info(list).n).style(T.tag).foregroundStyle(theme.on(list))
        }
        .frame(width: width)
        .overlay(theme.isPaper(list) ? Rectangle().strokeBorder(theme.ink, lineWidth: 2) : nil)
    }
}

/// Items that wrap onto the next line, like `flexWrap`. A row of three or
/// more controls must be able to wrap (DESIGN §4).
struct Flow: Layout {
    var spacing: CGFloat = Tokens.Space.sm
    var lineSpacing: CGFloat = Tokens.Space.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for (i, origin) in rows.origins.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                              proposal: ProposedViewSize(width: min(rows.sizes[i].width, bounds.width), height: nil))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (origins: [CGPoint], sizes: [CGSize], width: CGFloat, height: CGFloat) {
        var origins: [CGPoint] = [], sizes: [CGSize] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0, maxW: CGFloat = 0
        for v in subviews {
            var size = v.sizeThatFits(.unspecified)
            if size.width > width { size = v.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0, x + size.width > width { x = 0; y += lineH + lineSpacing; lineH = 0 }
            origins.append(CGPoint(x: x, y: y)); sizes.append(size)
            x += size.width + spacing; lineH = max(lineH, size.height); maxW = max(maxW, x - spacing)
        }
        return (origins, sizes, maxW, y + lineH)
    }
}
