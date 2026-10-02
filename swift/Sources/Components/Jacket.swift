// Jacket.swift — one saved thing, as a cover. A port of `Cover` in app/App.tsx.
//
// Artwork if there is any, type if there is not — never a grey box. A picture
// that is MISSING and a picture that FAILS land on the same designed thing:
// the typographic jacket (DESIGN §6).
//
// Every size here is either a token or the answer of a function in
// DesignMath: the title is sized from its longest word, a quote by area, a
// note by what the page holds. Nothing is set by eye.
import SwiftUI

extension View {
    /// A named style with its line box EXACTLY `lineHeight` tall, as React
    /// Native lays text out. `style(_:)` can only add space between lines, so
    /// a style whose line is shorter than the face's own (the band at 31/31,
    /// a jacket title at 1.05) came out taller than the Expo app's.
    @ViewBuilder func lineBox(_ s: TextStyle) -> some View {
        if #available(iOS 26.0, *) {
            self.font(s.font).tracking(s.resolvedTracking).textCase(s.uppercase ? .uppercase : nil)
                .lineHeight(.exact(points: s.resolvedLine))
                // `.exact` stands the baseline one font size below the top of
                // the line (measured). React Native centres the face in the
                // line, so the glyphs are moved to where it puts them.
                .offset(y: s.resolvedLine / 2 - s.resolvedSize * (1 - LineBox.middle))
        } else {
            // ponytail: before iOS 26 there is no line height to set. One line
            // is exact; a wrapped title set tighter than the face stays at the
            // face's own leading.
            self.style(s).padding(.vertical, (s.resolvedLine - s.resolvedSize * 1.19) / 2)
        }
    }
}

enum LineBox {
    /// How far the middle of the face (half way from descender to ascender)
    /// sits above the baseline, per point of size. Read off the face itself.
    static let middle: CGFloat = {
        let face = CTFontCreateWithName("HelveticaNeue" as CFString, 100, nil)
        return (CTFontGetAscent(face) - CTFontGetDescent(face)) / 200
    }()
}

struct Jacket: View {
    @Environment(\.theme) private var theme
    let item: Item
    let width: CGFloat
    var height: CGFloat? = nil

    init(item: Item, width: CGFloat, height: CGFloat? = nil) {
        self.item = item; self.width = width; self.height = height
    }

    // The strip and the foot, as App.tsx `coverStrip` / `coverFoot` set them.
    private static let stripH: CGFloat = 22
    private static let footMinH: CGFloat = 24
    /// What the quote solver leaves for a foot (App.tsx `foot`).
    private static let footAllow: CGFloat = 28

    /// The trim a title gets: its height and which composition.
    static func trim(_ item: Item) -> DesignMath.Cover { DesignMath.coverFor(item.title ?? item.id) }

    /// What VoiceOver reads for a jacket: the title, then who or where.
    static func spoken(_ item: Item) -> String {
        let main = DesignMath.mainTitle(item.title ?? "")
        return (main.isEmpty ? "Untitled" : main) + (item.subtitle.isEmpty ? "" : ", \(item.subtitle)")
    }

    var body: some View {
        let dims = Jacket.trim(item)
        let h = height ?? CGFloat(dims.height)
        let list = item.list
        let fill = theme.field(list)
        let on = theme.on(list)
        // Notes is paper: the jacket is the page. Wishlist keeps its cover and
        // stands a price tag on the foot, so it takes one composition.
        let paper = theme.isPaper(list)
        let wish = list == "wishlist"
        // Composition 2 inverts the jacket: same two colours, opposite roles.
        let inverted = dims.comp == 2 && !wish && !paper
        let field = inverted ? on : fill
        let mark = inverted ? fill : on

        VStack(spacing: 0) {
            if paper {
                page(height: h, on: on)
            } else if let url = art {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        Color.clear.overlay(image.resizable().scaledToFill()).clipped()
                    case .failure:
                        typed(dims, height: h, wish: wish, field: field, mark: mark)
                    default:
                        field
                    }
                }
            } else {
                typed(dims, height: h, wish: wish, field: field, mark: mark)
            }
            if wish { priceTag }
        }
        // The keyline is INSIDE the trim, as a border is in React Native.
        .padding(Tokens.coverKeyline)
        .frame(width: width, height: h)
        .background(field)
        .clipped()
        // Trimmed in ink: the one colour that contrasts the paper in both schemes.
        .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: Tokens.coverKeyline))
    }

    private var art: URL? {
        guard let s = item.imageURL, !s.isEmpty else { return nil }
        return URL(string: s)
    }

    /// The typographic jacket: mass at the top, at the foot, or centred.
    private func typed(_ dims: DesignMath.Cover, height h: CGFloat, wish: Bool, field: Color, mark: Color) -> some View {
        let isQuote = item.list == "quotes"
        let raw = item.title ?? ""
        let showStrip = !wish && dims.comp != 0
        let showFoot = !wish && dims.comp != 1 && !item.subtitle.isEmpty
        // THE BOX IS NOT THE JACKET: the strip and the foot take their share
        // before the quote is solved.
        let strip = dims.comp != 0 ? Jacket.stripH : 0
        let foot = dims.comp != 1 && !item.subtitle.isEmpty ? Jacket.footAllow : 0
        let q = isQuote ? DesignMath.quoteType(raw, coverWidth: Double(width), coverHeight: Double(h - strip - foot - Tokens.Space.md)) : nil
        let main = DesignMath.mainTitle(raw)
        let title = q.map { $0.fits ? JSCompat.trim(raw) : DesignMath.excerpt(raw, maxChars: $0.chars ?? 80) }
            ?? (main.isEmpty ? "Untitled" : main)
        let sized = DesignMath.jacketType(title, coverWidth: Double(width))
        var style = T.coverTitle
        style.size = CGFloat(q?.fontSize ?? sized.fontSize)
        style.lineHeight = CGFloat(q?.lineHeight ?? sized.lineHeight)
        // A quote is read, not glanced: regular weight, normal tracking.
        if isQuote { style.weight = .regular; style.tracking = 0 }
        let lines = wish ? 4 : (q?.lines ?? 5)
        let at: Alignment = wish || dims.comp == 0 ? .topLeading : dims.comp == 1 ? .bottomLeading : .leading

        return VStack(spacing: 0) {
            if showStrip {
                // The series number alone; the band above already names the shelf.
                Text(Lists.info(item.list).n).lineBox(T.tag).monospacedDigit().foregroundStyle(field).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Tokens.Space.sm)
                    .frame(height: Jacket.stripH)
                    .background(mark)
                    .layoutPriority(1)
            }
            box(at) {
                Text(title).lineBox(style).foregroundStyle(mark).lineLimit(lines).multilineTextAlignment(.leading)
            }
            if showFoot {
                Text(item.subtitle).lineBox(T.tag).foregroundStyle(field).lineLimit(2).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Tokens.Space.sm)
                    .padding(.vertical, Tokens.Space.xs)
                    .frame(minHeight: Jacket.footMinH)
                    .background(mark)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
            }
        }
    }

    /// A note's jacket is a page: the words, from the top.
    private func page(height h: CGFloat, on: Color) -> some View {
        let said = !item.note.isEmpty ? item.note : (item.title ?? "")
        let page = DesignMath.noteType(said, coverWidth: Double(width), coverHeight: Double(h))
        var loud = T.bodyMed
        loud.weight = .bold
        return box(.topLeading) {
            Text(page.text.isEmpty ? "Empty note" : page.text).lineBox(page.loud ? loud : T.meta)
                .foregroundStyle(on).lineLimit(page.lines).multilineTextAlignment(.leading)
        }
    }

    /// App.tsx `coverBody`: fills what is left, 8pt in, 12pt from the top.
    private func box<V: View>(_ at: Alignment, @ViewBuilder _ content: () -> V) -> some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: at)
            .padding(EdgeInsets(top: Tokens.Space.md, leading: Tokens.Space.sm, bottom: Tokens.Space.sm, trailing: Tokens.Space.sm))
    }

    /// THE PRICE TAG. On paper, not on the picture. A thing with no price says
    /// so: "no price" and "free" must not look alike.
    private var priceTag: some View {
        let price = ListsLogic.priceOn(item)
        var figure = T.meta
        figure.weight = .bold
        return VStack(spacing: 0) {
            theme.ink.frame(height: Tokens.coverKeyline)
            Text(price ?? "No price").lineBox(price != nil ? figure : T.micro).monospacedDigit()
                .foregroundStyle(price != nil ? theme.ink : theme.inkSoft).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.sm)
                .padding(.vertical, Tokens.Space.xs)
        }
        .background(theme.bg)
        .layoutPriority(1)
    }
}
