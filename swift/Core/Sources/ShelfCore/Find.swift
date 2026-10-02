// Find.swift — one box that looks through everything you have ever kept.
// Port of app/src/find.js, checked against golden-find.json.
//
// Ranking is the kind of code that is wrong in ways a screenshot cannot show —
// "why is that fourth" has no visual answer — so every score here is the JS's
// score to the last bit, and the golden file holds the order.
//
// THE RULES THIS FILE IS BUILT ON
//
// 1. EVERY WORD MUST MATCH SOMETHING. Two words are a narrowing, never a
//    widening: "clarke piranesi" is the one book.
// 2. MATCH THE FIELDS A PERSON REMEMBERS: the title, but also the author, the
//    city, the year, and above all the note they typed.
// 3. A MATCH THE TITLE DOES NOT EXPLAIN MUST SAY WHERE IT CAME FROM (`why`,
//    `snippet`). Never make somebody guess why they are looking at a row.
// 4. FORGIVE THE TYPING. Accents, case, punctuation and one wrong letter in a
//    long word do not mean "show me nothing".
//
// INDEXES ARE UTF-16 UNITS, as in JS. The JS finds a word in the FOLDED text
// and cuts the RAW text at that number, so the port has to count the same
// units or a snippet opens in a different place. Text is held as `[UInt16]`
// wherever a number points into it, and turned back into a String at the end.
// A cut through the middle of an emoji leaves half of one; JS keeps the half,
// Swift writes U+FFFD in its place.
import Foundation

enum Find {
    typealias Units = [UInt16]

    /// Where a match came from. `list` is the shelf's own name.
    enum Field: String, Sendable, CaseIterable { case title, subtitle, tags, facts, note, caption, ocr, article, list }

    /// Field weights. The title dominates; a caption is background noise that
    /// should break a tie and never win one.
    ///
    /// `list` is worth more than it looks: typing a shelf's name in full means
    /// "show me my books", and it has to outrank a one-letter typo match on
    /// some other shelf's title (worth 5). It stays under a title PREFIX (8.5).
    ///
    /// `tags` sits just above `facts`: the author on the tag outranks the same
    /// word turning up in an address.
    ///
    /// `ocr` and `article` are BODY TEXT and are low on purpose. An article is
    /// three thousand words; almost any query is in one somewhere. Both stay
    /// under 5, the WEAKEST thing a title can score, so a title match of any
    /// kind outranks a body match of every kind.
    static func weight(_ f: Field) -> Double {
        switch f {
        case .title: return 10
        case .subtitle: return 4
        case .tags: return 4.5
        case .facts: return 4
        case .note: return 3
        case .list: return 6
        case .ocr: return 2
        case .article: return 1.5
        case .caption: return 1
        }
    }

    struct FieldText: Equatable, Sendable {
        var name: Field
        var weight: Double
        var text: String
    }

    struct Hit: Equatable, Sendable {
        var item: Item
        var score: Double
        /// The field that explains the row, or nil when the title does.
        var why: Field?
        /// The words around the match, for a row that has to explain itself.
        var snippet: String?
    }

    struct Results: Equatable, Sendable {
        var hits: [Hit] = []
        /// Matches per shelf, counted BEFORE the shelf filter.
        var counts: [String: Int] = [:]
        /// How many matched after the filter and before the limit.
        var total = 0
        var terms: [String] = []
    }

    static func fold(_ s: String?, useNormalize: Bool = true) -> String { Tags.fold(s, useNormalize: useNormalize) }

    private static func isWord(_ u: UInt16) -> Bool { (u >= 97 && u <= 122) || (u >= 48 && u <= 57) }

    static func wordUnits(_ s: String?) -> [Units] {
        var out: [Units] = []
        var cur = Units()
        for u in fold(s).utf16 {
            if isWord(u) { cur.append(u) } else if !cur.isEmpty { out.append(cur); cur = [] }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    /// Foldable words, punctuation dropped. "St. John's" → ["st","john","s"].
    static func words(_ s: String?) -> [String] { wordUnits(s).map { JSLogic.string($0) } }

    /// First letters, for "hp" → "Harry Potter". Only ever tried on a title.
    static func initials(_ toks: [String]) -> String { JSLogic.string(toks.compactMap { $0.utf16.first }) }

    /// One substitution, insertion, deletion or transposition apart?
    ///
    /// Bounded at one on purpose. Two edits on an eight-letter word starts
    /// matching unrelated words, and a search that returns things you did not
    /// ask for is worse than one that returns nothing.
    static func withinOneEdit(_ a: Units, _ b: Units) -> Bool {
        if a == b { return true }
        let la = a.count, lb = b.count
        if abs(la - lb) > 1 { return false }
        if la == lb {
            var diff = -1
            for i in 0..<la where a[i] != b[i] {
                if diff >= 0 {
                    // A transposition — "teh" for "the" — is one keystroke, not two.
                    return diff == i - 1 && a[diff] == b[i] && a[i] == b[diff] && a[(i + 1)...] == b[(i + 1)...]
                }
                diff = i
            }
            return true
        }
        let (long, short) = la > lb ? (a, b) : (b, a)
        var j = 0
        for i in 0..<long.count {
            if j < short.count, long[i] == short[j] { j += 1 } else if i != j { return false }
        }
        return true
    }
    static func withinOneEdit(_ a: String, _ b: String) -> Bool { withinOneEdit(Array(a.utf16), Array(b.utf16)) }

    /// How well one typed word matches one stored word, 0 to 1.
    ///
    /// The gaps between these numbers ARE the ranking. A word typed in full
    /// beats a word started; a start beats a word that merely contains it; a
    /// typo comes last, and only for words long enough that one wrong letter is
    /// a slip and not a different word ("cat" is not a typo for "car").
    static func tokenScore(_ q: Units, _ tok: Units) -> Double {
        if q.isEmpty || tok.isEmpty { return 0 }
        if tok == q { return 1 }
        if tok.starts(with: q) { return 0.85 }
        if q.count >= 3, JSLogic.indexOf(tok, q) >= 0 { return 0.55 }
        if q.count >= 4, tok.count >= 4, withinOneEdit(q, tok) { return 0.5 }
        return 0
    }
    static func tokenScore(_ q: String, _ tok: String) -> Double { tokenScore(Array(q.utf16), Array(tok.utf16)) }

    // Keys and values that are machinery, not language. Searching
    // "openlibrary" must not return every book, and a cover URL holds the
    // words "covers", "images" and sometimes the whole title.
    // Two checks, not one: the substring list catches `place_id`, `image_url`;
    // the exact set catches the bare ones — `key` slipped past a
    // substring-only check once, and every searched item carries one.
    private static let noisyName: Set<String> = ["key", "id", "url", "href", "slug", "source", "lat", "lng", "lon", "located"]
    private static let noisyKey = ["_key", "_id", "_url", "url", "href", "image", "photo", "thumb", "slug", "coord"]
    private static let noisyValue = ["http:", "https:", "/", "geo:", "data:"]
    // Not noise — the opposite. These hold whole pages of prose, and they are
    // searched as fields of their own at their own low weight. Left in the
    // facts, every search would return every article.
    private static let ownField: Set<String> = ["article", "ocr_text"]

    private static func asciiLower(_ s: String) -> String {
        String(decoding: s.utf8.map { $0 >= 65 && $0 <= 90 ? $0 + 32 : $0 }, as: UTF8.self)
    }

    /// The searchable words inside `canonical` — the author, the city, the
    /// cuisine, the year. The half of an item a person remembers when they
    /// have forgotten the title.
    ///
    /// KEY ORDER: JS walks the keys in the order the file has them. A Swift
    /// dictionary has no order, so this walks them sorted (`JSLogic.orderedKeys`).
    /// The words found are the same and so is every score; only the ORDER of
    /// the words in a `facts` snippet can differ from the Expo app's.
    static func factsText(_ canonical: [String: JSONValue]) -> String {
        factsText(JSLogic.orderedKeys(canonical).map { ($0, canonical[$0] ?? .null) }, depth: 0)
    }

    private static func factsText(_ entries: [(String, JSONValue)], depth: Int) -> String {
        if depth > 3 { return "" }
        var out: [String] = []
        for (k, v) in entries {
            let lowKey = asciiLower(k)
            if noisyName.contains(JSLogic.lowercased(k)) || noisyKey.contains(where: { lowKey.contains($0) }) { continue }
            if depth == 0, ownField.contains(k) { continue }
            switch v {
            case .null, .bool: continue
            case .number(let n): out.append(JSLogic.number(n))
            case .string(let s):
                let low = asciiLower(String(s.prefix(8)))
                if s.utf16.count > 80 || noisyValue.contains(where: { low.hasPrefix($0) }) { continue }
                out.append(s)
            case .array(let a):
                out.append(factsText(a.enumerated().map { (String($0.offset), $0.element) }, depth: depth + 1))
            case .object(let o):
                out.append(factsText(JSLogic.orderedKeys(o).map { ($0, o[$0] ?? .null) }, depth: depth + 1))
            }
        }
        return out.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The shelf's own name as searchable text.
    ///
    /// Deliberately narrow: a shelf only ever matches a word typed IN FULL, so
    /// "books" shows every book and "boo" does not. A partial match would let
    /// three letters drown a real title match under forty rows of one shelf.
    private static let listWords: [String: [String]] = [
        "books": ["books", "book", "reading", "read"],
        "restaurants": ["restaurants", "restaurant", "eat", "food", "dinner"],
        "movies": ["movies", "movie", "film", "films", "watch", "tv"],
        "recipes": ["recipes", "recipe", "cook", "cooking"],
        "quotes": ["quotes", "quote", "said"],
        "places": ["places", "place", "travel", "trip", "visit"],
        "wishlist": ["wishlist", "wish", "buy", "shopping"],
        "notes": ["notes", "note"],
        "unsorted": ["unsorted", "pile", "inbox"],
    ]

    /// What a row prints for a tag match, and what the tag field is searched as.
    private static func tagsText(_ item: Item) -> String { Tags.for(item).map(\.value).joined(separator: " · ") }

    /// The SHORT fields of one item, each with its raw text kept for snippets.
    /// The two long ones — article and ocr — are not here: see `bodyText`.
    static func fields(of item: Item) -> [FieldText] {
        let caption = item.caption ?? ""
        return [
            FieldText(name: .title, weight: weight(.title), text: item.title ?? ""),
            FieldText(name: .subtitle, weight: weight(.subtitle), text: item.subtitle),
            FieldText(name: .tags, weight: weight(.tags), text: tagsText(item)),
            FieldText(name: .facts, weight: weight(.facts), text: factsText(item.canonical)),
            FieldText(name: .note, weight: weight(.note), text: item.note),
            FieldText(name: .caption, weight: weight(.caption), text: caption.utf16.count > 2000 ? JSLogic.string(caption.utf16.prefix(2000)) : caption),
        ]
    }

    // ── BODY TEXT: an article, and the words read off a screenshot ───────────
    //
    // Searched DIFFERENTLY from every field above, for two reasons.
    //
    // 1. No fuzziness. In a title, "ook" finding "book" is a kindness. Across
    //    three thousand words it matches everything: "art" is inside "party"
    //    and "start" in any article ever written. A body matches a WHOLE word
    //    or the START of one, and nothing else.
    // 2. No splitting into words per keystroke. A body is folded ONCE, kept,
    //    and the query is looked for in it as a run of units.
    static let bodyMax = 20000

    /// The parts a body is made of. Who wrote it and what it comes to, THEN the
    /// page: the byline is the part somebody remembers, and it must not be the
    /// part the cap cuts off.
    private static func bodyParts(_ item: Item, _ field: Field) -> [String] {
        let c = item.canonical
        if field == .ocr { return [c["ocr_text"]?.string ?? ""] }
        guard field == .article, let a = c["article"]?.object else { return [] }
        return ["byline", "summary", "text"].map { a[$0]?.string ?? "" }
    }

    private static func bodyUnits(_ parts: [String]) -> Units {
        let joined = parts.filter { !$0.isEmpty }.joined(separator: "\n")
        return Array(joined.utf16.prefix(bodyMax))
    }

    /// The raw prose of a body field, for a snippet. "" when there is none.
    /// Only `.ocr` and `.article` have one.
    static func bodyText(_ item: Item, _ field: Field) -> String { JSLogic.string(bodyUnits(bodyParts(item, field))) }

    /// The folded copy of each body, kept so the first keystroke pays to fold
    /// an article and the rest are a scan over it.
    ///
    /// ponytail: one row per item id, never dropped by itself — call `clear()`
    /// when a shelf is thrown away. Two known ceilings, both the JS's own:
    /// only the first `bodyMax` units are searched, and a row is reused while
    /// the item's texts compare equal (Swift's `==`, which is instant for an
    /// untouched string). If either is felt: build one inverted index (word →
    /// item ids) when the shelf loads, and drop this.
    final class BodyCache: @unchecked Sendable {
        private struct Row { var parts: [String]; var raw: Units; var folded: Units }
        private var rows: [String: [Field: Row]] = [:]
        private let lock = NSLock()
        private var count = 0

        /// How many bodies have been folded. A test reads this to prove that
        /// five keystrokes fold an article once.
        var folds: Int { lock.withLock { count } }

        func clear() { lock.withLock { rows.removeAll() } }

        fileprivate func body(_ item: Item, _ field: Field) -> (raw: Units, folded: Units) {
            let parts = Find.bodyParts(item, field)
            if parts.allSatisfy(\.isEmpty) { return ([], []) }
            return lock.withLock {
                if let row = rows[item.id]?[field], row.parts == parts { return (row.raw, row.folded) }
                let raw = Find.bodyUnits(parts)
                let folded = Array(Find.fold(JSLogic.string(raw)).utf16)
                count += 1
                rows[item.id, default: [:]][field] = Row(parts: parts, raw: raw, folded: folded)
                return (raw, folded)
            }
        }
    }
    static let cache = BodyCache()

    /// Where a typed word is in a folded body, and how well: 1 for a whole
    /// word, 0.85 for the start of one — the same two numbers `tokenScore`
    /// gives them — and 0 for anything that only turns up mid-word.
    static func bodyHit(_ hay: Units, _ q: Units) -> (score: Double, at: Int) {
        var best: (score: Double, at: Int) = (0, -1)
        if hay.isEmpty || q.isEmpty { return best }
        var i = JSLogic.indexOf(hay, q)
        while i >= 0 {
            if i == 0 || !isWord(hay[i - 1]) {
                let after = i + q.count
                if after >= hay.count || !isWord(hay[after]) { return (1, i) }
                if best.score == 0 { best = (0.85, i) }
            }
            i = JSLogic.indexOf(hay, q, from: i + 1)
        }
        return best
    }
    static func bodyHit(_ hay: String, _ q: String) -> (score: Double, at: Int) { bodyHit(Array(hay.utf16), Array(q.utf16)) }

    /// Score one item against already-folded query words. Nil means it does
    /// not match at all — rule 1, every word has to land somewhere.
    static func score(_ item: Item, terms: [String], phrase: String) -> Hit? {
        score(item, terms: terms.map { Array($0.utf16) }, phrase: Array(phrase.utf16))
    }

    private static func score(_ item: Item, terms: [Units], phrase: Units) -> Hit? {
        if terms.isEmpty { return nil }
        let short = fields(of: item).map { (name: $0.name, weight: $0.weight, toks: wordUnits($0.text)) }
        let listToks = listWords[item.list].map { $0.map { Array($0.utf16) } } ?? wordUnits(item.list)
        let titleInitials = short[0].toks.map { $0[0] }

        var total = 0.0
        // Which field explained the most about WHY this row is here. The title
        // never needs explaining, so a title match is never the answer.
        var best: (field: Field?, gain: Double) = (nil, 0)

        for q in terms {
            var gain = 0.0
            var from: Field?
            for f in short {
                var m = 0.0
                for tok in f.toks {
                    m = max(m, tokenScore(q, tok))
                    if m == 1 { break }
                }
                // "hp", "lotr" — initials only, and only on a title, where
                // they are how people actually abbreviate.
                if f.name == .title, q.count >= 2, titleInitials.starts(with: q) { m = max(m, 0.6) }
                let v = m * f.weight
                if v > gain { gain = v; from = f.name }
            }
            // The long fields, and only when they could still win: a word the
            // title already explained never costs a scan of the article.
            for name in [Field.ocr, .article] {
                if weight(name) <= gain { continue }
                let v = bodyHit(cache.body(item, name).folded, q).score * weight(name)
                if v > gain { gain = v; from = name }
            }
            // The shelf name, whole word only.
            if listToks.contains(q), weight(.list) > gain { gain = weight(.list); from = .list }
            if gain == 0 { return nil }
            total += gain
            if from != .title, gain > best.gain { best = (from, gain) }
        }

        // Phrase bonuses. "book bar" typed in that order, against a title that
        // IS "Book Bar", must beat a note somewhere else holding both words.
        let titleFold = Array(fold(item.title).utf16)
        if !phrase.isEmpty, !titleFold.isEmpty {
            if titleFold == phrase { total += 12 }
            else if titleFold.starts(with: phrase) { total += 6 }
            else if JSLogic.indexOf(titleFold, phrase) >= 0 { total += 4 }
        }

        let why = best.field
        return Hit(item: item, score: total, why: why, snippet: why.flatMap { snippet(of: item, field: $0, terms: terms) })
    }

    /// `text.slice(a, b)` — out-of-range numbers are clamped, never a crash.
    private static func slice(_ u: Units, _ a: Int, _ b: Int) -> ArraySlice<UInt16> {
        let lo = min(max(a, 0), u.count), hi = min(max(b, 0), u.count)
        return lo < hi ? u[lo..<hi] : []
    }

    private static func cut(_ text: Units, _ start: Int, _ end: Int) -> String {
        (start > 0 ? "…" : "") + JSLogic.string(JSLogic.trim(slice(text, start, end))) + (end < text.count ? "…" : "")
    }

    /// The words around the match, so a row that matched on a note can show
    /// the bit of note that matched. Rule 3: a row has to explain itself.
    static func snippet(of item: Item, field: Field, terms: [String], width: Int = 84) -> String? {
        snippet(of: item, field: field, terms: terms.map { Array($0.utf16) }, width: width)
    }

    private static func snippet(of item: Item, field: Field, terms: [Units], width: Int = 84) -> String? {
        let isBody = field == .ocr || field == .article
        let text: Units
        let hay: Units
        if isBody {
            (text, hay) = cache.body(item, field)
        } else {
            let s: String
            switch field {
            case .note: s = item.note
            case .caption: s = item.caption ?? ""
            case .subtitle: s = item.subtitle
            case .facts: s = factsText(item.canonical)
            case .tags: s = tagsText(item)
            default: s = ""
            }
            text = Array(s.utf16)
            hay = Array(fold(s).utf16)
        }
        if text.isEmpty { return nil }
        let len = text.count
        var at = -1
        for q in terms {
            // A body only ever matched at the start of a word, so that is
            // where its snippet has to open — the first "art" in an article
            // is inside "party".
            let i = isBody ? bodyHit(hay, q).at : JSLogic.indexOf(hay, q)
            if i >= 0, at < 0 || i < at { at = i }
        }
        if at < 0 { return cut(text, 0, min(width, len)) }
        // Back off a third of the width for context, then SNAP TO A WORD.
        // Cutting mid-word gave "….6 Michael B. Jordan" out of a cast list,
        // which reads as damaged data rather than as an excerpt.
        var start = max(0, at - width / 3)
        if start > 0 {
            let space = start < len ? (text[start...].firstIndex(of: 32) ?? -1) : -1
            // Never skip past the match itself chasing a space.
            if space >= 0, space < at { start = space + 1 }
        }
        var end = min(len, start + width)
        if end < len {
            let space = text[...end].lastIndex(of: 32) ?? -1
            if space > at { end = space }
        }
        return cut(text, start, end)
    }

    private static func freshness(_ item: Item) -> Double {
        let s = (item.resolvedAt?.isEmpty == false ? item.resolvedAt : nil) ?? item.createdAt
        return JSLogic.dateParse(s) ?? 0
    }

    /// Everything on every shelf that matches, best first.
    ///
    /// `counts` is computed BEFORE the shelf filter so the shelf chips can say
    /// how many are hiding behind each one. A blank query matches nothing,
    /// never everything. `limit` is how many hits come back; `total` is how
    /// many there were. Pass `Int.max` for all of them.
    static func search(items: [Item], query: String?, limit: Int = 60, list: String? = nil) -> Results {
        let phrase = Array(JSLogic.trim(fold(query)).utf16)
        let terms = wordUnits(query)
        if terms.isEmpty { return Results() }

        var scored: [(hit: Hit, fresh: Double, order: Int)] = []
        var counts: [String: Int] = [:]
        for item in items {
            guard let hit = score(item, terms: terms, phrase: phrase) else { continue }
            counts[item.list, default: 0] += 1
            scored.append((hit, 0, scored.count))
        }
        var kept = (list ?? "").isEmpty ? scored : scored.filter { $0.hit.item.list == list }
        for i in kept.indices { kept[i].fresh = freshness(kept[i].hit.item) }
        // Freshness only ever breaks a tie; the order given breaks the rest,
        // as a stable sort does in JS.
        kept.sort { a, b in
            if a.hit.score != b.hit.score { return a.hit.score > b.hit.score }
            if a.fresh != b.fresh { return a.fresh > b.fresh }
            return a.order < b.order
        }
        let end = limit < 0 ? max(0, kept.count + limit) : min(limit, kept.count)
        return Results(hits: kept[..<end].map(\.hit), counts: counts, total: kept.count, terms: terms.map { JSLogic.string($0) })
    }

    /// Is this catalogue result already on a shelf?
    ///
    /// Two ways, because items arrive by two roads. Something added from search
    /// carries the catalogue key in `canonical.key` and matches exactly.
    /// Something that came off a reel has no key at all, so the fallback is
    /// the folded title on the same shelf.
    static func alreadyShelved(_ items: [Item], key: String?, title: String?, list: String) -> Bool {
        let folded = fold(title)
        return items.contains { it in
            if let key, !key.isEmpty, let have = it.canonical["key"]?.string, JSLogic.same(have, key) { return true }
            return !folded.isEmpty && it.list == list && JSLogic.same(fold(it.title), folded)
        }
    }
}
