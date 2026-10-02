// Tags.swift — what an item can be filed under, read off the facts it has.
// Port of app/src/tags.js, checked against golden-tags.json.
//
// A TAG IS A FACT, NEVER A GUESS. A catalogue said who wrote the book and which
// neighbourhood the restaurant is in, and those are the tags. If the catalogue
// did not say it there is no tag, and an item with no tags is a correct answer.
import Foundation

/// The few corners of JavaScript the five logic ports must copy exactly:
/// how it trims, lower-cases, compares and prints. Kept in one place so Find,
/// Facts, Tags, Links and ListsLogic cannot disagree with each other.
enum JSLogic {
    typealias Units = [UInt16]

    /// JS `\s`, which is also what `trim()` removes. Not Foundation's set: that
    /// one has U+0085 and lacks U+FEFF.
    static func isSpace(_ u: UInt16) -> Bool {
        switch u {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }
    static func isSpace(_ s: Unicode.Scalar) -> Bool { s.value <= 0xFFFF && isSpace(UInt16(s.value)) }

    /// `s.trim()`
    static func trim(_ s: String) -> String {
        let u = s.unicodeScalars
        guard let a = u.firstIndex(where: { !isSpace($0) }), let b = u.lastIndex(where: { !isSpace($0) }) else { return "" }
        return String(u[a...b])
    }

    /// `u.trim()` on UTF-16 units.
    static func trim(_ u: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var a = u.startIndex, b = u.endIndex
        while a < b, isSpace(u[a]) { a += 1 }
        while b > a, isSpace(u[b - 1]) { b -= 1 }
        return u[a..<b]
    }

    /// `s.replace(/\s+/g, with)`
    static func squash(_ s: String, with: String = " ") -> String {
        var out = ""
        var inRun = false
        for c in s.unicodeScalars {
            if isSpace(c) {
                if !inRun { out += with; inRun = true }
            } else {
                out.unicodeScalars.append(c)
                inRun = false
            }
        }
        return out
    }

    /// `s.toLowerCase()`. Swift's own `lowercased()` maps one letter at a time,
    /// so a Greek capital sigma at the end of a word stays "σ" where JS writes
    /// "ς". That one rule (Final_Sigma) is the only difference, and it is here.
    static func lowercased(_ s: String) -> String {
        if s.utf8.allSatisfy({ $0 < 0x80 }) { return s.lowercased() }
        let u = Array(s.unicodeScalars)
        var out = ""
        for (i, c) in u.enumerated() {
            guard c.value == 0x3A3 else { out += c.properties.lowercaseMapping; continue }
            var before = false, after = false
            var j = i - 1
            while j >= 0 {
                if u[j].properties.isCased { before = true; break }
                if !u[j].properties.isCaseIgnorable { break }
                j -= 1
            }
            var k = i + 1
            while k < u.count {
                if u[k].properties.isCased { after = true; break }
                if !u[k].properties.isCaseIgnorable { break }
                k += 1
            }
            out += before && !after ? "ς" : "σ"
        }
        return out
    }

    /// JS truthiness: null, false, 0, NaN and "" are false. An empty array is true.
    static func truthy(_ v: JSONValue?) -> Bool {
        switch v {
        case nil, .null?: return false
        case .bool(let b)?: return b
        case .number(let n)?: return n != 0 && !n.isNaN
        case .string(let s)?: return !s.isEmpty
        case .array?, .object?: return true
        }
    }

    /// `Number.isFinite(v)` — a real number, and nothing that merely looks like one.
    static func finite(_ v: JSONValue?) -> Double? {
        if case .number(let n)? = v, n.isFinite { return n }
        return nil
    }

    /// `String(v ?? "")`: what JS prints for a value. A year that is the number
    /// 2020 prints "2020", an array prints its parts joined by commas.
    static func text(_ v: JSONValue?) -> String {
        switch v {
        case nil, .null?: return ""
        case .bool(let b)?: return b ? "true" : "false"
        case .number(let n)?: return number(n)
        case .string(let s)?: return s
        case .array(let a)?: return a.map(text).joined(separator: ",")
        case .object?: return "[object Object]"
        }
    }

    /// `String(n)` for a JS number: "2020", "4.3", "1e+21", "1e-7".
    static func number(_ d: Double) -> String {
        if d.isNaN { return "NaN" }
        if d.isInfinite { return d < 0 ? "-Infinity" : "Infinity" }
        if d == 0 { return "0" }
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        // Swift prints the same shortest digits JS does; only the layout differs
        // ("1e-07" for "1e-7", "1e+16" for "10000000000000000"). Take the digits
        // and lay them out by the rule in ECMA-262 Number::toString.
        var s = abs(d).description
        var exp = 0
        if let e = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            exp = Int(s[s.index(after: e)...]) ?? 0
            s = String(s[..<e])
        }
        var intLen = s.count
        if let dot = s.firstIndex(of: ".") {
            intLen = s.distance(from: s.startIndex, to: dot)
            s.remove(at: dot)
        }
        var digits = Array(s)
        var n = intLen + exp
        while digits.count > 1, digits.first == "0" { digits.removeFirst(); n -= 1 }
        while digits.count > 1, digits.last == "0" { digits.removeLast() }
        let k = digits.count
        let sign = d < 0 ? "-" : ""
        let all = String(digits)
        if k <= n, n <= 21 { return sign + all + String(repeating: "0", count: n - k) }
        if 0 < n, n <= 21 { return sign + String(digits[..<n]) + "." + String(digits[n...]) }
        if -6 < n, n <= 0 { return sign + "0." + String(repeating: "0", count: -n) + all }
        let e = n - 1
        let tail = (e < 0 ? "e-" : "e+") + String(abs(e))
        return sign + String(digits[0]) + (k > 1 ? "." + String(digits[1...]) : "") + tail
    }

    /// `a < b` on two JS strings: by UTF-16 unit, not by Swift's own order.
    static func less(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

    /// `a === b` on two JS strings. Swift's `==` also calls "é" and "e + accent"
    /// equal; JS does not.
    static func same(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }

    static func string(_ u: some Sequence<UInt16>) -> String { String(decoding: Array(u), as: UTF16.self) }

    /// `hay.indexOf(needle, from)`, or -1.
    static func indexOf(_ hay: Units, _ needle: Units, from: Int = 0) -> Int {
        let n = needle.count, h = hay.count
        let start = max(0, from)
        if n == 0 { return min(start, h) }
        if h - n < start { return -1 }
        let first = needle[0]
        return hay.withUnsafeBufferPointer { hp in
            needle.withUnsafeBufferPointer { np in
                var i = start
                let last = h - n
                while i <= last {
                    if hp[i] == first {
                        var j = 1
                        while j < n, hp[i + j] == np[j] { j += 1 }
                        if j == n { return i }
                    }
                    i += 1
                }
                return -1
            }
        }
    }

    /// The keys of a JS object in the order JS walks them — as near as a Swift
    /// dictionary allows. JS walks whole-number keys first, in number order,
    /// then the rest in the order they were written. A dictionary does not
    /// remember that order, so the rest are walked sorted (by UTF-16 unit).
    static func orderedKeys(_ o: [String: JSONValue]) -> [String] {
        func index(_ k: String) -> UInt64? {
            let b = Array(k.utf8)
            guard !b.isEmpty, b.count <= 10, b.allSatisfy({ $0 >= 48 && $0 <= 57 }), b.count == 1 || b[0] != 48 else { return nil }
            let v = UInt64(k) ?? .max
            return v < 4_294_967_295 ? v : nil
        }
        var numeric: [(UInt64, String)] = []
        var rest: [String] = []
        for k in o.keys {
            if let i = index(k) { numeric.append((i, k)) } else { rest.append(k) }
        }
        return numeric.sorted { $0.0 < $1.0 }.map { $0.1 } + rest.sorted(by: less)
    }

    /// `Date.parse(s)` in milliseconds, or nil where JS gives NaN.
    ///
    /// The date-time format of ECMA-262 and no other: "2026-08-01",
    /// "2026-08-01T09:00:00Z", "2026-08-01T09:00:00.000+01:00". That is every
    /// date this app has ever written (`toISOString`). V8 also guesses at
    /// "Aug 1 2026"; this does not.
    static func dateParse(_ s: String) -> Double? {
        let b = Array(s.utf8)
        var i = 0
        func digits(_ n: Int) -> Int? {
            guard i + n <= b.count else { return nil }
            var v = 0
            for k in 0..<n {
                guard b[i + k] >= 48, b[i + k] <= 57 else { return nil }
                v = v * 10 + Int(b[i + k] - 48)
            }
            i += n
            return v
        }
        func eat(_ c: UInt8, _ alt: UInt8? = nil) -> Bool {
            guard i < b.count, b[i] == c || b[i] == alt else { return false }
            i += 1
            return true
        }
        let year: Int
        if eat(43) { guard let y = digits(6) else { return nil }; year = y }
        else if eat(45) { guard let y = digits(6), y != 0 else { return nil }; year = -y }
        else { guard let y = digits(4) else { return nil }; year = y }
        var month = 1, day = 1
        if eat(45) {
            guard let m = digits(2) else { return nil }
            month = m
            if eat(45) { guard let d = digits(2) else { return nil }; day = d }
        }
        var h = 0, mi = 0, sec = 0, ms = 0
        var hasTime = false
        var offset: Int?
        if eat(84, 116) {
            hasTime = true
            guard let hh = digits(2), eat(58), let mm = digits(2) else { return nil }
            h = hh; mi = mm
            if eat(58) {
                guard let ss = digits(2) else { return nil }
                sec = ss
                if eat(46) || eat(44) {
                    var n = 0, scale = 100
                    while i < b.count, b[i] >= 48, b[i] <= 57 {
                        ms += Int(b[i] - 48) * scale
                        scale /= 10
                        i += 1; n += 1
                    }
                    guard n > 0 else { return nil }
                }
            }
            if eat(90, 122) { offset = 0 }
            else if i < b.count, b[i] == 43 || b[i] == 45 {
                let neg = b[i] == 45
                i += 1
                guard let oh = digits(2) else { return nil }
                _ = eat(58)
                guard let om = digits(2) else { return nil }
                offset = (neg ? -1 : 1) * (oh * 60 + om)
            }
        }
        guard i == b.count, (1...12).contains(month), (1...31).contains(day), mi < 60, sec < 60,
              h < 24 || (h == 24 && mi == 0 && sec == 0 && ms == 0) else { return nil }
        // Days from 1970-01-01 (Howard Hinnant's civil-date arithmetic). A day
        // past the end of its month rolls into the next, as V8 does.
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        let days = era * 146097 + doe - 719468
        var t = Double(days) * 86_400_000 + Double(h * 3_600_000 + mi * 60_000 + sec * 1000 + ms)
        if hasTime {
            if let offset { t -= Double(offset) * 60_000 }
            // No zone on a date WITH a time means the phone's own.
            else { t -= Double(TimeZone.current.secondsFromGMT(for: Date(timeIntervalSince1970: t / 1000))) * 1000 }
        }
        return t
    }
}

enum Tags {
    struct Tag: Equatable, Hashable, Sendable {
        var kind: String
        var value: String
        /// `author:susanna clarke` — the tag's identity.
        var key: String
    }

    /// One row of the tag view: a tag and what is under it.
    struct Row: Equatable, Sendable {
        var key: String
        var kind: String
        var value: String
        var count: Int
        var ids: [String]
    }

    // The Latin-1 letters that turn up in book titles and restaurant names.
    // JS walks this table only on an engine with no `normalize`; it is ported
    // because the JS selftest exercises it, and so the golden file does too.
    private static let accents: [Unicode.Scalar: String] = [
        "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a", "ā": "a",
        "é": "e", "è": "e", "ê": "e", "ë": "e", "ē": "e",
        "í": "i", "ì": "i", "î": "i", "ï": "i", "ī": "i",
        "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ø": "o", "ō": "o",
        "ú": "u", "ù": "u", "û": "u", "ü": "u", "ū": "u",
        "ñ": "n", "ç": "c", "ß": "ss", "æ": "ae", "œ": "oe", "ý": "y", "ÿ": "y",
    ]

    /// Fold accents and case away. It lives HERE and Find uses it, because a
    /// tag's identity and a search's matching must fold the same way: a tag you
    /// can see and cannot find by typing it is two definitions of "same".
    static func fold(_ s: String?, useNormalize: Bool = true) -> String {
        let lower = JSLogic.lowercased(s ?? "")
        if lower.utf8.allSatisfy({ $0 < 0x80 }) { return lower }
        var out = String.UnicodeScalarView()
        if useNormalize {
            // NFD, then drop the combining marks U+0300…U+036F.
            for c in lower.decomposedStringWithCanonicalMapping.unicodeScalars where !(0x300...0x36F).contains(c.value) { out.append(c) }
        } else {
            for c in lower.unicodeScalars {
                if let plain = accents[c] { out.append(contentsOf: plain.unicodeScalars) } else { out.append(c) }
            }
        }
        return String(out)
    }

    private static let punctuation: Set<Unicode.Scalar> = [".", ",", ";", ":", "!", "?", "'", "\"", "’", "‘", "“", "”", "(", ")", "[", "]", "/", "_", "-"]

    /// The stable id of a tag: `author:susanna clarke`.
    ///
    /// Folded, with punctuation and spacing flattened, so "Susanna Clarke" and
    /// "susanna  CLARKE." are ONE tag. The punctuation is NAMED rather than
    /// "anything that is not a-z": a name in another script has to survive as
    /// itself, or every one of them becomes the same empty key.
    static func key(kind: String, value: String?) -> String {
        var out = String.UnicodeScalarView()
        var inRun = false
        for c in fold(value).unicodeScalars {
            if JSLogic.isSpace(c) || punctuation.contains(c) {
                if !inRun { out.append(" "); inRun = true }
            } else {
                out.append(c)
                inRun = false
            }
        }
        let v = JSLogic.trim(String(out))
        return v.isEmpty ? "" : "\(kind):\(v)"
    }

    // Open Library's year is a number and TMDB's is a string. Either way it has
    // to LOOK like a year first: a decade of "0s" out of a missing release date
    // is exactly the empty tag this file forbids.
    private static func year(_ v: JSONValue?) -> String {
        let s = JSLogic.trim(JSLogic.text(v))
        let b = Array(s.utf8)
        guard b.count == 4, b.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return "" }
        let century = Int(b[0] - 48) * 10 + Int(b[1] - 48)
        return (15...20).contains(century) ? s : ""
    }

    /// The tags of one item, in the order a person would filter by: WHO MADE
    /// IT, then WHERE IT IS, then WHAT KIND, then WHO IS IN IT, then WHEN, then
    /// where you read it.
    ///
    /// ONLY A FILED ITEM HAS TAGS. A pending or unread row is a link nobody has
    /// read yet, and whatever is sitting in its fields is not a fact.
    static func `for`(_ item: Item) -> [Tag] {
        guard item.status == .filed else { return [] }
        let c = item.canonical
        var out: [Tag] = []
        var seen = Set<String>()

        // One value or an array of them — `cuisine` is both, depending on the shelf.
        func add(_ kind: String, _ v: JSONValue?) {
            guard let v else { return }
            for one in v.array ?? [v] {
                let raw: String
                switch one {
                case .string(let s): raw = s
                case .number(let n): raw = JSLogic.number(n)
                default: continue
                }
                let value = JSLogic.trim(JSLogic.squash(raw))
                let key = key(kind: kind, value: value)
                // 60 is a length no name reaches and a sentence always does. A
                // blurb that landed in an author field is not a tag.
                if key.isEmpty || value.utf16.count > 60 || seen.contains(key) { continue }
                seen.insert(key)
                out.append(Tag(kind: kind, value: value, key: key))
            }
        }

        // A quote comes back with an empty canonical; whoever said it is in the
        // subtitle. For a quote, and only for a quote, the subtitle is the author.
        add("author", JSLogic.truthy(c["author"]) ? c["author"] : (item.list == "quotes" ? .string(item.subtitle) : nil))
        add("director", c["director"])
        // Who MAKES it. Only on a thing to buy: `brand` on anything else is a
        // field nobody vouched for.
        add("brand", c["kind"]?.string == "product" ? c["brand"] : nil)
        // The map falls back to the city when a place has no suburb, so `area`
        // and `city` are often the same word. Said once, as the city.
        if key(kind: "x", value: JSLogic.text(c["area"])) != key(kind: "x", value: JSLogic.text(c["city"])) { add("area", c["area"]) }
        add("city", c["city"])
        add("cuisine", c["cuisine"])
        // A book's subjects and a film's genres are the same question asked of
        // two catalogues, so they are one kind: "Fantasy" finds both.
        add("genre", c["genres"])
        add("genre", c["subjects"])
        add("cast", c["cast"])
        let y = year(c["year"])
        add("year", .string(y))
        add("decade", y.isEmpty ? nil : .string(String(y.prefix(3)) + "0s"))
        // JS: `c.article && c.article.siteName` — a falsy article is passed on as it is.
        let article = c["article"]
        add("site", JSLogic.truthy(article) ? article?["siteName"] : article)
        return out
    }

    /// Every tag on the shelf, with what is under it. Most-used first, then by
    /// name, so two tags with the same count do not swap places between two
    /// reads. The spelling shown is the first one met.
    static func index(_ items: [Item]) -> [Row] {
        var rows: [Row] = []
        var at: [String: Int] = [:]
        for item in items {
            for t in self.for(item) {
                if let i = at[t.key] {
                    rows[i].count += 1
                    rows[i].ids.append(item.id)
                } else {
                    at[t.key] = rows.count
                    rows.append(Row(key: t.key, kind: t.kind, value: t.value, count: 1, ids: [item.id]))
                }
            }
        }
        func name(_ r: Row) -> String { JSLogic.string(r.key.utf16.dropFirst(r.kind.utf16.count + 1)) }
        return rows.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            let na = name(a), nb = name(b)
            if JSLogic.less(na, nb) { return true }
            if JSLogic.less(nb, na) { return false }
            return JSLogic.less(a.key, b.key)
        }
    }

    /// The items under one tag, in the order they were given.
    static func items(_ items: [Item], withTag key: String) -> [Item] {
        items.filter { item in self.for(item).contains { JSLogic.same($0.key, key) } }
    }
}
