// Theme.swift — the bridge from Tokens (generated from design.js) to SwiftUI.
//
// It holds no values of its own, for the same reason app/src/theme.ts does
// not: a number that lived only here could drift from the file that is
// checked. Colours, sizes and spaces all come from `Tokens`.
import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

/// The live palette. Built from the colour scheme inside a view, never frozen
/// at launch — a theme captured once cannot follow the system appearance.
struct Theme: Sendable {
    let p: Palette
    let dark: Bool

    init(_ scheme: ColorScheme) {
        dark = scheme == .dark
        p = scheme == .dark ? Tokens.dark : Tokens.light
    }

    var bg: Color { Color(hex: p.bg) }
    var surfaceSunk: Color { Color(hex: p.surfaceSunk) }
    var placeholder: Color { Color(hex: p.placeholder) }
    var ink: Color { Color(hex: p.ink) }
    var inkSoft: Color { Color(hex: p.inkSoft) }
    var inkFaint: Color { Color(hex: p.inkFaint) }
    var line: Color { Color(hex: p.line) }
    var accent: Color { Color(hex: p.accent) }
    var good: Color { Color(hex: p.good) }
    var warn: Color { Color(hex: p.warn) }

    /// A shelf's field. Notes is PAPER: its field is the page itself.
    func field(_ list: String) -> Color { Color(hex: p.field(list)) }

    /// Is this shelf drawn on paper (an ink keyline) rather than a fill?
    func isPaper(_ list: String) -> Bool { p.field(list) == p.bg }

    /// The label colour on a shelf's field. THE ONE WAY TO ASK — yellow cannot
    /// carry white, and paper carries ink, which inverts between schemes.
    func on(_ list: String) -> Color {
        if isPaper(list) { return ink }
        return Color(hex: Tokens.listOn[list] ?? p.onList)
    }
}

private struct ThemeKey: EnvironmentKey { static let defaultValue = Theme(.light) }
extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// Put at the root: reads the system scheme and hands every view the palette.
struct Themed<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder var content: () -> Content
    var body: some View { content().environment(\.theme, Theme(scheme)) }
}

// ── type ─────────────────────────────────────────────────────────────────────
//
// ONE family. Helvetica Neue is the shipping face on iOS for this system (the
// Expo app fell through to the system font; design.js names Helvetica as the
// reference). Every step carries its own line height and tracking.

struct TextStyle: Sendable {
    var step: TypeStep
    var weight: Font.Weight? = nil
    var size: CGFloat? = nil
    var lineHeight: CGFloat? = nil
    var tracking: CGFloat? = nil
    var uppercase = false

    /// Helvetica Neue has no semibold: asked for 600 it falls to Medium, which
    /// is visibly lighter than the design (the reference renders 600 as bold,
    /// as every Expo screenshot shows). So 600 is drawn bold here.
    var resolvedWeight: Font.Weight { let w = weight ?? step.weight; return w == .semibold ? .bold : w }
    var font: Font { .custom("HelveticaNeue", fixedSize: size ?? step.size).weight(resolvedWeight) }
    var resolvedSize: CGFloat { size ?? step.size }
    var resolvedLine: CGFloat { lineHeight ?? step.lineHeight }
    var resolvedTracking: CGFloat { tracking ?? step.tracking }
}

/// The named styles, matching `t` in app/src/theme.ts one for one.
enum T {
    static let wordmark = TextStyle(step: Tokens.Text.display, weight: .bold, size: 42, lineHeight: 48, tracking: -2.6)
    static let band = TextStyle(step: Tokens.Text.title, weight: .bold, size: 31, lineHeight: 31, tracking: -1.5, uppercase: true)
    static let itemTitle = TextStyle(step: Tokens.Text.heading, weight: .bold, tracking: -0.4)
    static let coverTitle = TextStyle(step: Tokens.Text.heading, weight: .bold,
                                      lineHeight: (Tokens.Text.heading.size * 1.05).rounded(), tracking: -0.5)
    static let detailTitle = TextStyle(step: Tokens.Text.display, weight: .bold, tracking: -1.4)
    static let title = TextStyle(step: Tokens.Text.title)
    static let section = TextStyle(step: Tokens.Text.meta, weight: .bold, tracking: 0.9, uppercase: true)
    static let tag = TextStyle(step: Tokens.Text.micro, weight: .bold, tracking: 0.5, uppercase: true)
    static let read = TextStyle(step: Tokens.Text.read)
    static let body = TextStyle(step: Tokens.Text.body)
    static let bodyMed = TextStyle(step: Tokens.Text.bodyMed)
    static let meta = TextStyle(step: Tokens.Text.meta)
    static let micro = TextStyle(step: Tokens.Text.micro, weight: .bold, tracking: 1.8, uppercase: true)
}

extension View {
    /// Font, tracking, line height and case from one named style.
    func style(_ s: TextStyle) -> some View {
        self.font(s.font)
            .tracking(s.resolvedTracking)
            .lineSpacing(max(0, s.resolvedLine - s.resolvedSize * 1.19))
            .textCase(s.uppercase ? .uppercase : nil)
    }
}

/// The shelves as a person sees them: label, singular, plate number.
struct ListInfo: Sendable { let key: String; let label: String; let one: String; let n: String }

enum Lists {
    private static let labels: [String: (String, String)] = [
        "books": ("Books", "book"), "restaurants": ("Restaurants", "place"), "movies": ("Movies", "film"),
        "recipes": ("Recipes", "recipe"), "quotes": ("Quotes", "quote"), "places": ("Places", "place"),
        "wishlist": ("Wishlist", "thing"), "notes": ("Notes", "note"), "unsorted": ("Not shelved", "item"),
    ]
    /// Derived from the generated key order — a ninth shelf appears here
    /// without anybody remembering to add it (it gets its key as its label).
    static let all: [ListInfo] = {
        let shelves = Tokens.listKeys.filter { $0 != "unsorted" }
        return Tokens.listKeys.map { k in
            let i = shelves.firstIndex(of: k).map { $0 + 1 } ?? 0
            let l = labels[k] ?? (k.capitalized, "item")
            return ListInfo(key: k, label: l.0, one: l.1, n: String(format: "%02d", i))
        }
    }()
    static let shelves: [ListInfo] = all.filter { $0.key != "unsorted" }
    static func info(_ key: String?) -> ListInfo {
        all.first { $0.key == key } ?? ListInfo(key: key ?? "", label: key ?? "", one: "item", n: "00")
    }
}
