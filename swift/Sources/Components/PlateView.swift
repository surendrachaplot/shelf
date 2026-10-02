// PlateView.swift — the ex-libris plate, drawn. A port of app/src/ExLibris.tsx.
//
// The generator (Core/ExLibris.swift) returns a DESCRIPTION; this is one of
// its renderers. It draws exactly the shapes it is given, in a 0...100 box
// scaled to `size`, and resolves the three colour roles against the LIVE
// palette. Nothing here may be improved: a plate somebody has must not change.
import SwiftUI

struct PlateView: View {
    @Environment(\.theme) private var theme
    let seed: String
    let size: CGFloat

    var body: some View {
        let plate = ExLibris.plate(for: seed)
        // The same three answers `ExLibris.colours` gives, as colours: the
        // ground is the shelf's field, the mark is the label that shelf names.
        let ground = theme.field(plate.list), mark = theme.on(plate.list), paper = theme.bg
        let shapes = ExLibris.shapes(for: seed)
        Canvas { ctx, _ in
            let k = size / CGFloat(ExLibris.plate)
            func colour(_ role: ExLibris.Role) -> Color {
                switch role { case .ground: ground; case .mark: mark; case .paper: paper }
            }
            func stroke(_ path: Path, _ role: ExLibris.Role, _ sw: Double) {
                ctx.stroke(path, with: .color(colour(role)), lineWidth: CGFloat(sw) * k)
            }
            for shape in shapes {
                switch shape {
                case let .rect(x, y, w, h, fill, line, sw):
                    let path = Path(CGRect(x: x * k, y: y * k, width: w * k, height: h * k))
                    if let fill { ctx.fill(path, with: .color(colour(fill))) }
                    if let line { stroke(path, line, sw) }
                case let .circle(cx, cy, r, line, sw):
                    stroke(Path(ellipseIn: CGRect(x: (cx - r) * k, y: (cy - r) * k, width: 2 * r * k, height: 2 * r * k)), line, sw)
                case let .line(x1, y1, x2, y2, line, sw):
                    var path = Path()
                    path.move(to: CGPoint(x: x1 * k, y: y1 * k))
                    path.addLine(to: CGPoint(x: x2 * k, y: y2 * k))
                    stroke(path, line, sw)
                case let .poly(points, line, sw):
                    var path = Path()
                    path.addLines(points.map { CGPoint(x: $0[0] * k, y: $0[1] * k) })
                    path.closeSubpath()
                    stroke(path, line, sw)
                case let .arc(cx, cy, r, from, to, line, sw):
                    // Degrees, y down, in the direction the angle grows — which
                    // is what `clockwise: false` means in this flipped space.
                    var path = Path()
                    path.addArc(center: CGPoint(x: cx * k, y: cy * k), radius: r * k,
                                startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
                    stroke(path, line, sw)
                case let .text(x, y, value, fontSize, fill):
                    // Centred on x, BASELINE at y, bold, tracking -1 plate unit.
                    let text = ctx.resolve(Text(value)
                        .font(.custom("HelveticaNeue", fixedSize: fontSize * k).weight(.bold))
                        .tracking(-1 * k)
                        .foregroundStyle(colour(fill)))
                    let box = text.measure(in: CGSize(width: size * 4, height: size * 4))
                    let baseline = text.firstBaseline(in: box)
                    ctx.draw(text, at: CGPoint(x: x * k, y: y * k - baseline), anchor: .top)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#Preview("Plates") {
    Themed {
        HStack(spacing: Tokens.Space.sm) {
            ForEach(["suren", "shelf", "maya", "ab", "q"], id: \.self) { PlateView(seed: $0, size: Tokens.touchMin + Tokens.Space.xl) }
        }
    }
}
