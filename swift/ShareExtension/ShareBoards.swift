// ShareBoards.swift — the picker. Port of app/src/ShareBoards.tsx.
//
// One tile per shelf, two across, edge to edge, filling the sheet. No gaps, no
// radius, no shadows: what makes a coloured field read as a SHELF is the board
// under it — a hard edge with visible thickness. Every tile has one.
//
// Type is the icon. Tight caps, ONE size for all eight solved from the longest
// name (`capsType`), so the right tile is hit without reading it. This is on
// screen for about a second, one handed, over whatever the person was doing.
import SwiftUI

struct ShareBoards: View {
    @ObservedObject var model: ShareModel
    @Environment(\.theme) private var theme

    private static let cols = 2
    private var shelves: [ListInfo] { Lists.shelves }

    var body: some View {
        GeometryReader { geo in
            if case .done(let list) = model.phase { done(list) } else { picker(width: geo.size.width) }
        }
    }

    // ── the picker ───────────────────────────────────────────────────────────

    private func picker(width: CGFloat) -> some View {
        let tileW = width / CGFloat(Self.cols)
        let caps = ShareLogic.capsType(shelves.map(\.label), boxWidth: tileW - Tokens.Space.lg * 2,
                                       max: T.band.resolvedSize, glyph: Tokens.Cover.capsGlyph,
                                       tracking: Tokens.Cover.capsTracking, floor: Tokens.Text.floor)
        let rows = stride(from: 0, to: shelves.count, by: Self.cols).map {
            Array(shelves[$0..<min($0 + Self.cols, shelves.count)])
        }
        return VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Put it on →").style(T.micro).foregroundStyle(theme.ink)
                Spacer(minLength: Tokens.Space.md)
                Text(model.source).style(T.meta).foregroundStyle(theme.inkFaint).lineLimit(1)
            }
            .frame(height: T.meta.resolvedLine)
            .padding(.horizontal, Tokens.Space.lg)
            .padding(.top, Tokens.Space.lg)
            .padding(.bottom, Tokens.Space.md)

            if let blocker = model.blocker {
                Text(blocker).style(T.read).foregroundStyle(theme.ink)
                    .padding(.horizontal, Tokens.Space.lg)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                foot("Close", left: "Nothing saved", right: "Close →") { model.close() }
            } else {
                // Each row takes an equal share of the height the sheet has,
                // so the unit always fills it.
                ForEach(rows.indices, id: \.self) { r in
                    HStack(spacing: 0) {
                        ForEach(rows[r], id: \.key) { tile($0, width: tileW, caps: caps) }
                        if rows[r].count < Self.cols { Color.clear }
                    }
                }
                foot("Let shelf decide which shelf", left: "Not sure", right: "Decide for me →") { model.save("unsorted") }
                    .disabled(!model.canSave || model.saving != nil)
                if case .failed(let message) = model.phase {
                    Text(message).style(T.meta).foregroundStyle(theme.accent)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Tokens.Space.lg).padding(.bottom, Tokens.Space.sm)
                }
            }
        }
        .background(theme.bg.ignoresSafeArea())
    }

    private func tile(_ s: ListInfo, width: CGFloat, caps: ShareLogic.Caps) -> some View {
        let on = theme.on(s.key)
        // Paper driven dark is grey in one scheme and invisible in the other,
        // so a paper shelf stands on ink, like a jacket does.
        let board = theme.isPaper(s.key) ? theme.ink : Color(hex: ShareLogic.darken(theme.p.field(s.key)))
        return Press("Put it on \(s.label)", size: width,
                     disabled: !model.canSave || model.saving != nil, action: { model.save(s.key) }) {
            VStack(spacing: 0) {
                // Number at the head, name on the foot: the two places a
                // jacket puts its series strip and its title.
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(s.n).style(T.micro)
                        Spacer(minLength: 0)
                        if model.saving == s.key { ProgressView().tint(on) } else { Text("→").style(T.micro) }
                    }
                    Spacer(minLength: 0)
                    Text(s.label)
                        .font(.custom("HelveticaNeue", fixedSize: caps.size).weight(.bold))
                        .tracking(caps.tracking)
                        .textCase(.uppercase)
                        .lineLimit(1)
                        .fixedSize()
                }
                .foregroundStyle(on)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.vertical, Tokens.Space.sm)
                .frame(maxWidth: .infinity, minHeight: Tokens.touchMin, maxHeight: .infinity, alignment: .leading)
                .background(theme.field(s.key))
                // A page-coloured tile on a page-coloured sheet is a hole in
                // the grid. The keyline is drawn INSIDE the padding, so "08"
                // and "NOTES" start on the same x as every other tile. No
                // bottom side: the ink board is that edge.
                .overlay { if theme.isPaper(s.key) { keyline } }
                Rectangle().fill(board).frame(height: Tokens.bandBoard)
            }
        }
    }

    private var keyline: some View {
        let w = Tokens.coverKeyline
        return ZStack {
            Rectangle().frame(height: w).frame(maxHeight: .infinity, alignment: .top)
            Rectangle().frame(width: w).frame(maxWidth: .infinity, alignment: .leading)
            Rectangle().frame(width: w).frame(maxWidth: .infinity, alignment: .trailing)
        }
        .foregroundStyle(theme.ink)
        .allowsHitTesting(false)
    }

    private func foot(_ label: String, left: String, right: String, action: @escaping () -> Void) -> some View {
        Press(label, size: 340, action: action) {
            HStack {
                Text(left).style(T.micro).foregroundStyle(theme.ink)
                Spacer(minLength: Tokens.Space.md)
                Text(right).style(T.micro).foregroundStyle(theme.inkFaint)
            }
            .lineLimit(1)
            .padding(.horizontal, Tokens.Space.lg)
            .frame(minHeight: Tokens.touch)
        }
    }

    // ── the receipt ──────────────────────────────────────────────────────────

    /// The shelf that was hit, filling the whole sheet. No tick, no dialog:
    /// the colour IS the receipt, and it reads at arm's length.
    private func done(_ list: String) -> some View {
        let on = theme.on(list)
        let board = theme.isPaper(list) ? theme.ink : Color(hex: ShareLogic.darken(theme.p.field(list)))
        return VStack(alignment: .leading, spacing: 0) {
            Text("Saved").style(T.micro).opacity(0.6)
            Text(Lists.info(list).label).style(T.wordmark).lineLimit(1).minimumScaleFactor(0.6)
                .padding(.top, Tokens.Space.sm)
            Text("shelf reads it next time you open the app").style(T.meta).opacity(0.8)
                .padding(.top, Tokens.Space.md)
        }
        .foregroundStyle(on)
        .padding(.horizontal, Tokens.Space.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .bottom) {
                theme.field(list)
                Rectangle().fill(board).frame(height: Tokens.bandBoard)
            }
            .overlay { if theme.isPaper(list) { keyline } }
            .ignoresSafeArea()
        }
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview("picker") {
    let model = ShareModel()
    model.demo()
    return Themed { ShareBoards(model: model) }.frame(height: ShareViewController.sheetHeight)
}
#Preview("done") {
    let model = ShareModel()
    model.demo(done: "restaurants")
    return Themed { ShareBoards(model: model) }.frame(height: ShareViewController.sheetHeight)
}
#endif
