// DesignMath.swift — the FUNCTIONS of app/src/design.js, ported.
//
// The token tables are not here: those are generated (DesignConstants.swift in
// Core, Tokens.swift in the app). This is the arithmetic that decides what a
// shelf looks like — how many columns, how big a title is set, where a note is
// cut — and it has to give the same answer as the Expo app, because a jacket
// that splits "Rosewoo / d" in one app and not the other is two products.
//
// PARITY IS CHECKED, case by case, against the real JS (golden-design.json,
// written by tools/golden/design.mjs). When a rule below looks odd, the reason
// is in design.js beside the function of the same name.
//
// STRINGS ARE COUNTED THE WAY JS COUNTS THEM: in UTF-16 units. "🍜".length is 2
// in JS and 1 in Swift, and every fit below is a count of characters.
import Foundation

enum DesignMath {
    private typealias C = DesignConstants

    // ── covers and the bookcase ──────────────────────────────────────────────

    struct Cover: Equatable, Sendable { let height: Double; let comp: Int }

    /// A title's trim height and which of the three layouts it gets. A hash,
    /// so one title is the same jacket on every phone, every launch.
    static func coverFor(_ title: String) -> Cover {
        var h = 7
        // JS walks code points and reads `charCodeAt(0)`: the FIRST UTF-16 unit.
        for s in title.unicodeScalars { h = (h * 31 + Int(s.utf16[s.utf16.startIndex])) % 997 }
        return Cover(height: C.coverHeights[(h >> 3) % C.coverHeights.count],
                     comp: (h + title.utf16.count) % C.coverComps)
    }

    struct Grid: Equatable, Sendable { let cols: Int; let width: Double }

    /// As many columns as fit at no less than `coverMinW`. `available <= 0`
    /// means not measured yet: paint nothing (cols 0), never guess a width.
    static func gridFor(available: Double, gap: Double) -> Grid {
        guard available > 0 else { return Grid(cols: 0, width: 0) }
        let cols = max(1, ((available + gap) / (C.coverMinW + gap)).rounded(.down))
        return Grid(cols: Int(cols), width: ((available - gap * (cols - 1)) / cols).rounded(.down))
    }

    /// Item indexes chunked into rows of `cols`, one board per row.
    static func rowsOf(_ n: Int, cols: Int) -> [[Int]] {
        guard cols > 0, n > 0 else { return [] }
        return stride(from: 0, to: n, by: cols).map { Array($0..<min($0 + cols, n)) }
    }

    static func rowPitch(gapAbove: Double) -> Double { gapAbove + (C.coverHeights.max() ?? 0) + C.board }
    static func emptyPitch(gapAbove: Double) -> Double { gapAbove + C.emptyBoardH + C.board }

    /// How many empty boards fill the screen under the last full one. Capped,
    /// so a tablet does not get twenty.
    static func emptyBoards(viewportH: Double, usedH: Double, pitch: Double) -> Int {
        guard viewportH > 0, pitch > 0 else { return 0 }
        return Int(max(0, min(Double(C.maxEmptyBoards), ((viewportH - usedH) / pitch).rounded(.up))))
    }

    // ── what is written on a jacket ──────────────────────────────────────────

    /// A cover carries the main title only: the part before a colon or an em
    /// dash, and before the first comma when that is still long.
    static func mainTitle(_ s: String) -> String {
        let u = Array(s.utf16)
        // `split(/\s*[:—]\s*/)[0].trim()`: everything before the first colon
        // or em dash. The trim takes the spaces that led up to it.
        let end = u.firstIndex { $0 == 0x3A || $0 == 0x2014 } ?? u.count
        let head = JSCompat.trim(u[0..<end])
        if head.isEmpty { return s }
        guard head.count > 28 else { return JSCompat.string(head) }
        // `split(/,\s/)[0]`: a comma with a space after it.
        let h = Array(head)
        let comma = h.indices.first { h[$0] == 0x2C && $0 + 1 < h.count && JSCompat.isSpace(h[$0 + 1]) } ?? h.count
        return JSCompat.string(JSCompat.trim(h[0..<comma]))
    }

    struct JacketType: Equatable, Sendable { let fontSize: Double; let lineHeight: Double }

    /// Jacket type sizes itself to its box from the LONGEST WORD, so no word is
    /// ever split mid-syllable. Floored to the half point, never rounded: a
    /// size rounded up puts the longest word outside the box, which is the
    /// whole defect again. The type floor outranks the fit.
    static func jacketType(_ title: String, coverWidth: Double) -> JacketType {
        let box = coverWidth - 2 * C.coverKeyline - 2 * C.coverPad
        let longest = max(1, longestWord(Array(title.utf16)))
        let fit = box / (Double(longest) * C.jacketGlyph)
        let size = max(C.typeFloor, min(C.heading.fontSize, (fit * 2).rounded(.down) / 2))
        return JacketType(fontSize: size, lineHeight: JSCompat.round(size * 1.05 * 2) / 2)
    }

    struct CapsType: Equatable, Sendable { let fontSize: Double; let lineHeight: Double; let letterSpacing: Double }

    /// Caps for a SET of labels that must all be one size: solved from the
    /// longest label, capped at `max`, floored at the type floor.
    static func capsType(_ labels: [String], boxWidth: Double, max cap: Double) -> CapsType {
        let longest = labels.reduce(1) { max($0, $1.utf16.count) }
        let fit = boxWidth / (Double(longest) * C.capsGlyph)
        let size = max(C.typeFloor, min(cap, (fit * 2).rounded(.down) / 2))
        return CapsType(fontSize: size, lineHeight: (size * 1.05).rounded(.up),
                        letterSpacing: JSCompat.round(C.capsTracking * size * 100) / 100)
    }

    struct QuoteType: Equatable, Sendable {
        let fontSize: Double
        let lineHeight: Double
        let lines: Int
        let fits: Bool
        /// Only when it does NOT fit: how many characters the floor holds, so
        /// the caller cuts on purpose (`excerpt`) instead of a line limit guessing.
        let chars: Int?
    }

    /// A quote's jacket is the whole quote, so it is solved by AREA: walk the
    /// size down until the lines fit the height. One line of slack, because
    /// word wrap never fills a line.
    static func quoteType(_ text: String, coverWidth: Double, coverHeight: Double) -> QuoteType {
        let boxW = max(1, coverWidth - 2 * C.coverKeyline - 2 * C.coverPad)
        let boxH = max(1, coverHeight - 2 * C.coverKeyline - 2 * C.coverPad)
        let len = Double(max(1, JSCompat.trim(Array(text.utf16)[...]).count))
        var size = C.heading.fontSize
        while size >= C.typeFloor {
            let perLine = max(1, (boxW / (size * C.quoteGlyph)).rounded(.down))
            let lines = (len / perLine).rounded(.up) + 1
            if lines * size * C.quoteLeading <= boxH {
                return QuoteType(fontSize: size, lineHeight: JSCompat.round(size * C.quoteLeading * 2) / 2, lines: Int(lines), fits: true, chars: nil)
            }
            size -= 0.5
        }
        let perLine = max(1, (boxW / (C.typeFloor * C.quoteGlyph)).rounded(.down))
        let lines = max(1, (boxH / (C.typeFloor * C.quoteLeading)).rounded(.down) - 1)
        return QuoteType(fontSize: C.typeFloor, lineHeight: JSCompat.round(C.typeFloor * C.quoteLeading * 2) / 2,
                         lines: Int(lines), fits: false, chars: Int(perLine * lines))
    }

    struct NoteType: Equatable, Sendable {
        /// A note short enough to be a heading: set at `bodyMed`, bold.
        let loud: Bool
        let text: String
        let lines: Int
    }

    /// A note's jacket is a page: the words, small, from the top, cut to what
    /// the page holds. The one exception is a note short enough for two lines
    /// at `bodyMed` with no word longer than a line — that is a heading.
    static func noteType(_ text: String, coverWidth: Double, coverHeight: Double) -> NoteType {
        let boxW = max(1, coverWidth - 2 * C.coverKeyline - 2 * C.coverPad)
        let boxH = max(1, coverHeight - 2 * C.coverKeyline - 2 * C.coverPad)
        // `replace(/\s+/g, " ").trim()`
        var said: [UInt16] = []
        for u in text.utf16 {
            if !JSCompat.isSpace(u) { said.append(u) } else if said.last != 0x20 { said.append(0x20) }
        }
        said = Array(JSCompat.trim(said[...]))
        let longest = Double(said.split(separator: 0x20).reduce(0) { max($0, $1.count) })
        let perLoud = (boxW / (C.bodyMed.fontSize * C.jacketGlyph)).rounded(.down)
        if Double(said.count) <= perLoud * 2, longest <= perLoud { return NoteType(loud: true, text: JSCompat.string(said), lines: 3) }
        let perLine = max(1, (boxW / (C.meta.fontSize * C.quoteGlyph)).rounded(.down))
        let lines = max(1, (boxH / C.meta.lineHeight).rounded(.down))
        return NoteType(loud: false, text: excerpt(JSCompat.string(said), maxChars: Int(perLine * max(1, lines - 1))), lines: Int(lines))
    }

    /// Cut on a WORD boundary, and say so with an ellipsis. A space is only
    /// taken when it is past the halfway mark: the threshold exists to stop one
    /// very long word being cut back to almost nothing.
    static func excerpt(_ text: String, maxChars: Int) -> String {
        let t = Array(JSCompat.trim(Array(text.utf16)[...]))
        if t.count <= maxChars { return JSCompat.string(t) }
        var cut = t[0..<min(t.count, max(1, maxChars - 1))]
        // -1 for "no space", as `lastIndexOf` gives — and compared as -1, so a
        // NEGATIVE `maxChars` behaves as it does in JS (`slice(0, -1)`).
        let at = cut.lastIndex(of: 0x20) ?? -1
        if Double(at) > Double(maxChars) * 0.5 { cut = cut[0..<(at < 0 ? max(0, cut.count + at) : at)] }
        // `replace(/[,;:.\s]+$/, "")`
        while let last = cut.last, last == 0x2C || last == 0x3B || last == 0x3A || last == 0x2E || JSCompat.isSpace(last) { cut = cut.dropLast() }
        return JSCompat.string(cut) + "…"
    }

    /// The longest run of non-space units: `split(/\s+/)`, longest piece.
    private static func longestWord(_ u: [UInt16]) -> Int {
        u.split(whereSeparator: JSCompat.isSpace).reduce(0) { max($0, $1.count) }
    }

    // ── colour ───────────────────────────────────────────────────────────────
    //
    // A palette is `[name: "#RRGGBB"]` — `DesignConstants.light` / `.dark`.

    /// "#RRGGBB" (or without the #) as three channels, 0...255. Nil for
    /// anything else. ponytail: six hex digits only; design.js has no other
    /// form, and JS would give NaN where this gives nil.
    static func rgb(_ hex: String) -> [Double]? {
        var h = Substring(hex)
        if let i = h.firstIndex(of: "#") { h.remove(at: i) }
        let d = Array(h.utf8)
        guard d.count >= 6 else { return nil }
        var out: [Double] = []
        for i in stride(from: 0, to: 6, by: 2) {
            guard let v = UInt8(String(decoding: d[i..<i + 2], as: UTF8.self), radix: 16) else { return nil }
            out.append(Double(v))
        }
        return out
    }

    /// Mix two hex colours in sRGB, `t` from 0 (all `a`) to 1 (all `b`). Used
    /// for one thing: a placeholder on a coloured field. A colour that cannot
    /// be read comes back as `a`, unmixed.
    static func mix(_ a: String, _ b: String, _ t: Double) -> String {
        guard let x = rgb(a), let y = rgb(b) else { return a }
        return "#" + (0..<3).map { i in
            let v = Int(JSCompat.round(x[i] + (y[i] - x[i]) * t))
            let s = String(v, radix: 16, uppercase: true)
            return s.count < 2 ? "0" + s : s
        }.joined()
    }

    /// WCAG 2.1 relative luminance. Exact, not approximated.
    static func luminance(_ hex: String) -> Double {
        guard let c = rgb(hex) else { return .nan }
        let v = c.map { $0 / 255 }.map { $0 <= 0.04045 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    }

    /// WCAG contrast ratio, to two places.
    static func contrast(_ a: String, _ b: String) -> Double {
        let (la, lb) = (luminance(a), luminance(b))
        return JSCompat.round(((max(la, lb) + 0.05) / (min(la, lb) + 0.05)) * 100) / 100
    }

    /// Is this shelf PAPER in this scheme — a field that is the page itself?
    /// Asked of the palette, not of the name, so it cannot disagree with what
    /// is painted. A paper shelf gets an ink keyline wherever it is a block.
    static func isPaper(_ list: String, _ palette: [String: String]) -> Bool {
        guard let field = palette[list], !field.isEmpty else { return false }
        return field == palette["bg"]
    }

    /// THE LABEL COLOUR FOR A SHELF, IN A SCHEME. Paper is written on in ink,
    /// and ink inverts, so the question takes the palette as well as the shelf.
    static func onFor(_ list: String, _ palette: [String: String]) -> String {
        isPaper(list, palette) ? palette["ink"] ?? "" : C.listOn[list] ?? palette["onList"] ?? ""
    }

    /// The placeholder colour for a label sitting on a list's field: the label
    /// dropped toward the field, so an empty box does not read as a filled one.
    static func placeholderOn(_ list: String, _ palette: [String: String]) -> String {
        mix(onFor(list, palette), palette[list] ?? palette["unsorted"] ?? "", C.placeholderMix)
    }

    // ── motion ───────────────────────────────────────────────────────────────

    struct Spring: Equatable, Sendable {
        let dampingRatio: Double
        let settleMs: Double
        let mass: Double
        let stiffness: Double
        let damping: Double
        let omega0: Double
    }

    /// A spring from the two numbers a person perceives: how much it overshoots
    /// (damping ratio) and how long until it is done (settle time, at 0.1%).
    /// Stiffness and damping are DERIVED; nobody picks a stiffness.
    static func spring(dampingRatio: Double, settleMs: Double, mass: Double = 1) -> Spring {
        let zw0 = -log(0.001) / (settleMs / 1000)
        let w0 = zw0 / dampingRatio
        return Spring(dampingRatio: dampingRatio, settleMs: settleMs, mass: mass,
                      stiffness: JSCompat.round(w0 * w0 * mass * 10) / 10,
                      damping: JSCompat.round(2 * dampingRatio * w0 * mass * 10) / 10,
                      omega0: w0)
    }

    /// Position of a unit spring at `t` seconds, 0 to 1, released at rest. All
    /// three damping regimes: a system that mishandles ζ ≥ 1 looks fine until
    /// somebody asks for a spring that does not bounce.
    static func springAt(_ s: Spring, _ t: Double) -> Double {
        let (z, w0) = (s.dampingRatio, s.omega0)
        if t <= 0 { return 0 }
        if abs(z - 1) < 1e-9 { return 1 - exp(-w0 * t) * (1 + w0 * t) }
        if z < 1 {
            let wd = w0 * (1 - z * z).squareRoot()
            return 1 - exp(-z * w0 * t) * (cos(wd * t) + ((z * w0) / wd) * sin(wd * t))
        }
        let r = w0 * (z * z - 1).squareRoot()
        let a = (z * w0 + r) / (2 * r)
        let b = (r - z * w0) / (2 * r)
        return 1 - exp(-z * w0 * t) * (a * exp(-r * t) + b * exp(r * t))
    }

    /// Press scale depends on size: a 44pt control and a 300pt card must not
    /// scale by the same factor, or the big one looks like it is collapsing.
    static func pressScale(_ sizePt: Double) -> Double { max(0.96, 1 - 2.2 / max(sizePt, 40)) }

    /// Milliseconds before item `i` starts. Never more than eight steps, or it
    /// stops reading as craft and starts reading as the app being slow.
    static func staggerDelay(_ i: Int) -> Double { Double(min(i, C.staggerMaxSteps - 1)) * C.staggerStep }
}

/// THE JAVASCRIPT SEMANTICS THE PORTS LEAN ON.
///
/// The Expo app is the reference, and its answers come out of JS strings, JS
/// rounding and JS dates. Where Swift's own idea of the same thing differs by
/// one character or one millisecond, the port would differ too — so the JS
/// rule is written down once, here, and the golden files check it.
enum JSCompat {
    /// `\s` in a JS regex, and what `trim()` strips. NOT `Character.isWhitespace`:
    /// that counts U+0085 and leaves out U+FEFF, and JS does the opposite.
    static func isSpace(_ u: UInt16) -> Bool {
        switch u {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    static func trim(_ u: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var s = u
        while let f = s.first, isSpace(f) { s = s.dropFirst() }
        while let l = s.last, isSpace(l) { s = s.dropLast() }
        return s
    }

    static func trim(_ s: String) -> String { string(trim(Array(s.utf16)[...])) }

    /// UTF-16 units back to a String. Half a surrogate pair (an emoji cut in
    /// two by a slice) becomes U+FFFD: a Swift String cannot hold the half.
    static func string(_ u: some Sequence<UInt16>) -> String { String(decoding: Array(u), as: UTF16.self) }

    /// `Math.round`: halves go UP (toward +∞), not away from zero and not to even.
    static func round(_ x: Double) -> Double {
        let f = x.rounded(.down)
        return x - f >= 0.5 ? f + 1 : f
    }

    /// A number the way a JS template prints it: `16`, not `16.0`.
    /// ponytail: exact for the decimals design.js holds (1e-4 ≤ |x| < 1e15).
    /// Outside that JS and Swift switch to exponents at different places.
    static func number(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e15 ? String(Int64(x)) : "\(x)"
    }

    /// `String(value)` for a JSON value: what a JS template or `String()` makes
    /// of a field that is not the string it was expected to be.
    static func string(_ v: JSONValue?) -> String {
        switch v {
        case nil, .null?: return ""
        case .bool(let b)?: return b ? "true" : "false"
        case .number(let n)?: return number(n)
        case .string(let s)?: return s
        case .array(let a)?: return a.map { string($0) }.joined(separator: ",")
        case .object?: return "[object Object]"
        }
    }

    /// JS truthiness: `filter(Boolean)`, `a || b`.
    static func truthy(_ v: JSONValue?) -> Bool {
        switch v {
        case nil, .null?: return false
        case .bool(let b)?: return b
        case .number(let n)?: return n != 0 && !n.isNaN
        case .string(let s)?: return !s.isEmpty
        case .array?, .object?: return true
        }
    }

    // ── dates ────────────────────────────────────────────────────────────────
    //
    // A JS Date is a whole number of milliseconds since 1970, and its "local"
    // fields are that number plus the zone's offset, read off a plain
    // Gregorian calendar. That is all that is done here — no Calendar, so no
    // locale, no first weekday, no Julian switch. THE ZONE IS AN ARGUMENT,
    // which is what lets a test (and a phone that has travelled) ask in any.

    static let dayMs: Double = 86_400_000

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }

    static func offsetMs(at utcMs: Double, _ tz: TimeZone) -> Double {
        Double(tz.secondsFromGMT(for: Date(timeIntervalSince1970: utcMs / 1000))) * 1000
    }

    struct LocalFields: Equatable {
        let year: Int
        /// 1...12
        let month: Int
        let day: Int
        /// 0 is Sunday, like `Date#getDay`.
        let weekday: Int
        let hour: Int
        let minute: Int
        /// Milliseconds since local midnight.
        let msOfDay: Double
    }

    static func local(_ utcMs: Double, _ tz: TimeZone) -> LocalFields {
        let l = utcMs + offsetMs(at: utcMs, tz)
        let days = (l / dayMs).rounded(.down)
        let msOfDay = l - days * dayMs
        let (y, m, d) = civil(fromDays: Int(days))
        let minutes = Int(msOfDay / 60000)
        return LocalFields(year: y, month: m, day: d, weekday: ((Int(days) % 7) + 11) % 7, hour: minutes / 60, minute: minutes % 60, msOfDay: msOfDay)
    }

    /// Days since 1970-01-01 for a civil date. `day` may run past the end of
    /// the month and rolls on, as `setFullYear` on 29 February needs it to.
    static func days(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        return era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468
    }

    static func civil(fromDays days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - (153 * mp + 2) / 5 + 1)
    }

    /// The instant for a LOCAL wall-clock time (given as if it were UTC ms).
    /// A time that happens twice (clocks going back) is the earlier one; a
    /// time that does not exist (clocks going forward) is read with the offset
    /// from before the change. Both are what JS does.
    static func utc(fromLocalMs l: Double, _ tz: TimeZone) -> Double {
        let before = offsetMs(at: l - dayMs, tz), after = offsetMs(at: l + dayMs, tz)
        let (c1, c2) = (l - before, l - after)
        let (ok1, ok2) = (offsetMs(at: c1, tz) == before, offsetMs(at: c2, tz) == after)
        if ok1 && ok2 { return min(c1, c2) }
        return ok2 && !ok1 ? c2 : c1
    }

    /// `new Date(string).getTime()`, for the ISO forms: `YYYY[-MM[-DD]]`, then
    /// optionally `THH:mm[:ss[.fff]]`, then optionally `Z` or `±HH:mm`. A date
    /// alone is UTC; a date with a time and no zone is LOCAL. Nil is JS's
    /// "Invalid Date".
    ///
    /// ponytail: the app writes every date with `toISOString()`, so this reads
    /// ISO and nothing else. V8 has an older, looser parser behind this one
    /// ("Oct 1 2026", "2026-10-01 12:00") that is NOT ported; those give nil.
    static func parseDate(_ text: String, _ tz: TimeZone) -> Double? {
        let b = Array(text.utf8)
        var i = 0
        func digits(_ n: Int) -> Int? {
            guard i + n <= b.count else { return nil }
            var v = 0
            for k in i..<i + n { guard b[k] >= 0x30, b[k] <= 0x39 else { return nil }; v = v * 10 + Int(b[k] - 0x30) }
            i += n
            return v
        }
        func eat(_ c: UInt8, or d: UInt8? = nil) -> Bool {
            guard i < b.count, b[i] == c || b[i] == d else { return false }
            i += 1
            return true
        }
        guard let year = digits(4) else { return nil }
        var (month, day) = (1, 1)
        if eat(0x2D) {
            guard let m = digits(2) else { return nil }
            month = m
            if eat(0x2D) { guard let d = digits(2) else { return nil }; day = d }
        }
        var (hour, minute, second, milli) = (0, 0, 0, 0)
        var hasTime = false
        if eat(0x54, or: 0x74) {
            hasTime = true
            guard let h = digits(2), eat(0x3A), let m = digits(2) else { return nil }
            (hour, minute) = (h, m)
            if eat(0x3A) {
                guard let s = digits(2) else { return nil }
                second = s
                if eat(0x2E) {
                    // Any number of digits; the first three are the milliseconds.
                    var n = 0
                    while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { if n < 3 { milli = milli * 10 + Int(b[i] - 0x30) }; n += 1; i += 1 }
                    guard n > 0 else { return nil }
                    for _ in min(n, 3)..<3 { milli *= 10 }
                }
            }
        }
        var offset: Double?
        // `Z` may follow a bare date; `+05:30` only a time.
        if eat(0x5A, or: 0x7A) { offset = 0 } else if hasTime, i < b.count, b[i] == 0x2B || b[i] == 0x2D {
            let sign: Double = b[i] == 0x2D ? -1 : 1
            i += 1
            guard let h = digits(2), eat(0x3A), let m = digits(2), h <= 23, m <= 59 else { return nil }
            offset = sign * Double(h * 60 + m) * 60000
        }
        guard i == b.count, (1...12).contains(month), (1...31).contains(day), minute <= 59, second <= 59,
              hour <= 23 || (hour == 24 && minute == 0 && second == 0 && milli == 0) else { return nil }
        let l = Double(days(year: year, month: month, day: day)) * dayMs + Double(hour * 3_600_000 + minute * 60000 + second * 1000 + milli)
        if let offset { return l - offset }
        return hasTime ? utc(fromLocalMs: l, tz) : l
    }
}
