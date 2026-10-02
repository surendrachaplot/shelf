// Serendipity.swift — what a shelf says to you when you did not ask it anything.
// A port of app/src/serendipity.js, checked case by case against it
// (golden-serendipity.json).
//
// NOTHING HERE READS THE CLOCK OR THE GPS: the time, the place and the time
// zone are arguments. That is what lets "a year ago this week" and "open until
// 23:00" be tested at all.
//
// THREE KINDS, IN THE ORDER OF WHAT YOU CAN DO ABOUT THEM:
//
// 1. NEAR YOU. A saved place within a walk of where you stand. First, because
//    it expires: in ten minutes you are somewhere else.
// 2. A YEAR AGO. Saved this week one, two or three years back.
// 3. FORGOTTEN. Filed long ago and never noted. Oldest first, turned by one
//    each day so the same card is not there every morning.
//
// THE RULE THAT OUTRANKS ALL OF IT: NEVER CLAIM OPEN ON A GUESS. Walking
// somebody 400 m to a locked door is worse than saying nothing. `openState`
// answers only for hours it can read with certainty and returns nil for
// everything else, and nil prints no words at all.
import Foundation

enum Serendipity {
    /// About twelve minutes on foot. Past that it is a trip, not a detour.
    static let walkM: Double = 1000
    /// "This week" is the anniversary and three and a half days either side.
    static let weekHalfMs: Double = 3.5 * JSCompat.dayMs
    /// How long before an item with no note counts as forgotten.
    static let forgottenDays: Double = 90

    struct LatLng: Equatable, Sendable {
        var lat: Double
        var lng: Double
        init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng }
        /// An item's pin. Nil unless BOTH are numbers: a string that looks
        /// like a number is not a pin.
        init?(_ canonical: [String: JSONValue]) {
            guard let lat = canonical["lat"]?.number, let lng = canonical["lng"]?.number, lat.isFinite, lng.isFinite else { return nil }
            self.init(lat: lat, lng: lng)
        }
    }

    /// Great-circle metres between two pins. Nil when either is missing —
    /// never zero, which would read as "right here".
    static func metresBetween(_ a: LatLng?, _ b: LatLng?) -> Double? {
        guard let a, let b, a.lat.isFinite, a.lng.isFinite, b.lat.isFinite, b.lng.isFinite else { return nil }
        func rad(_ d: Double) -> Double { (d * Double.pi) / 180 }
        let s1 = sin(rad(b.lat - a.lat) / 2), s2 = sin(rad(b.lng - a.lng) / 2)
        let h = s1 * s1 + cos(rad(a.lat)) * cos(rad(b.lat)) * s2 * s2
        return 2 * 6_371_000 * asin(h.squareRoot())
    }

    // ── opening hours ────────────────────────────────────────────────────────
    //
    // ponytail: this reads the simple common forms of OSM `opening_hours` and
    // nothing else — `24/7`, and `;`-separated rules of `[days] HH:MM-HH:MM[,…]`
    // or `[days] off`, where days are Mo..Su singly, in ranges, or comma-joined.
    // A later rule replaces an earlier one for the days it names (so `Mo-Su
    // 12:00-23:00; Tu off` closes Tuesday), a day no rule names is closed, and
    // a span that ends before it starts runs past midnight. THE CEILING: public
    // and school holidays (PH, SH), months, week numbers, `sunrise`/`sunset`,
    // open ends (`17:00+`), `||` fallbacks, comments and lower-case days all
    // return nil — the whole string, not just the rule, because one clause we
    // cannot read can overrule the ones we can. Upgrade path if coverage
    // matters: a full opening_hours parser, which needs the country for holidays.

    private static let days: [[UInt16]] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map { Array($0.utf16) } // Date#getDay order
    private typealias Span = (a: Int, b: Int)

    /// One rule, already trimmed: `[days ]body`. Nil if it is not EXACTLY that.
    /// Written by hand rather than as a regex because Foundation's `\d`, `\s`
    /// and `$` each mean something slightly wider than JS's.
    private static func rule(_ r: [UInt16]) -> (days: [Int]?, spans: [Span])? {
        var i = 0
        func day() -> Int? {
            guard i + 2 <= r.count, let d = days.firstIndex(of: Array(r[i..<i + 2])) else { return nil }
            i += 2
            return d
        }
        func eat(_ c: Character) -> Bool {
            guard i < r.count, r[i] == c.utf16.first else { return false }
            i += 1
            return true
        }
        // `Mo`, `Mo-Fr`, `Mo,We,Fr-Su` — then at least one space.
        var named: [Int]?
        if var from = day() {
            var out: [Int] = []
            while true {
                var to = from
                let mark = i
                if eat("-") { if let d = day() { to = d } else { i = mark } }
                // Fr-Mo wraps the week, and is a thing real bars write.
                var d = from
                while true { out.append(d); if d == to { break }; d = (d + 1) % 7 }
                let comma = i
                guard eat(","), let next = day() else { i = comma; break }
                from = next
            }
            let gap = i
            while i < r.count, JSCompat.isSpace(r[i]) { i += 1 }
            guard i > gap else { return nil }
            named = out
        }
        let body = JSCompat.string(r[i...])
        if body == "off" || body == "closed" { return (named, []) }
        // `HH:MM-HH:MM`, comma-joined, ASCII digits, and nothing after.
        var spans: [Span] = []
        func two() -> Int? {
            guard i + 2 <= r.count, (0x30...0x39).contains(r[i]), (0x30...0x39).contains(r[i + 1]) else { return nil }
            defer { i += 2 }
            return Int(r[i] - 0x30) * 10 + Int(r[i + 1] - 0x30)
        }
        func minutes() -> Int?? {
            guard let h = two(), eat(":"), let m = two() else { return nil }
            // Read, but not a time: 25:00, 09:60, 24:30.
            return .some(h > 24 || m > 59 || (h == 24 && m != 0) ? nil : h * 60 + m)
        }
        var bad = false
        repeat {
            guard let a = minutes(), eat("-"), let b = minutes() else { return nil }
            if let a, let b, a != b { spans.append((a, b > a ? b : b + 1440)) } else { bad = true }
        } while eat(",")
        guard i == r.count, !bad else { return nil }
        return (named, spans)
    }

    /// Seven arrays of spans in minutes, Sunday first — or nil if not certain.
    private static func week(_ hours: String) -> [[Span]]? {
        let s = JSCompat.trim(hours)
        if s.isEmpty { return nil }
        if s == "24/7" { return Array(repeating: [(0, 1440)], count: 7) }
        var week: [[Span]] = Array(repeating: [], count: 7)
        for raw in Array(s.utf16).split(separator: 0x3B, omittingEmptySubsequences: false) {
            // "12:00-15:00, 18:00-23:00" is the same thing with a space typed in.
            var r: [UInt16] = []
            var afterComma = false
            for u in JSCompat.trim(raw) {
                if afterComma, JSCompat.isSpace(u) { continue }
                afterComma = u == 0x2C
                r.append(u)
            }
            if r.isEmpty { continue }
            guard let (named, spans) = rule(r) else { return nil }
            for d in named ?? Array(0..<7) { week[d] = spans }
        }
        return week
    }

    struct OpenState: Equatable, Sendable {
        let open: Bool
        /// The end of the span you are in: "23:00", "midnight". Nil when it is
        /// closed, and nil when it never closes (24 hours).
        let until: String?
    }

    /// Is it open at `now`?
    ///
    ///     OpenState(open: true,  until: "23:00")   certain, and when it stops
    ///     OpenState(open: true,  until: nil)       certain, and it does not stop
    ///     OpenState(open: false, until: nil)       certain
    ///     nil                                      NOT KNOWN — say nothing
    ///
    /// `now` IS READ IN `timeZone` (the phone's), and opening hours are written
    /// in the PLACE'S local time. Those are the same clock only when you are
    /// standing near the place — which is why `surface` asks this for nothing
    /// but items within `walkM` of `here`. Do not call it for a restaurant in
    /// another time zone and believe the answer.
    ///
    /// Hours written as two spans that meet at midnight read "until midnight"
    /// rather than the later time: early, never late.
    static func openState(_ hours: String?, now: Date, timeZone: TimeZone = .current) -> OpenState? {
        guard let hours, let week = week(hours) else { return nil }
        let t = JSCompat.local(JSCompat.ms(now), timeZone)
        let m = t.hour * 60 + t.minute
        // Today's spans, then last night's that ran past midnight into today.
        let hit = week[t.weekday].first { m >= $0.a && m < $0.b }
            ?? week[(t.weekday + 6) % 7].map { (a: $0.a - 1440, b: $0.b - 1440) }.first { m >= $0.a && m < $0.b }
        guard let hit else { return OpenState(open: false, until: nil) }
        let always = week.allSatisfy { $0.contains { $0.a == 0 && $0.b == 1440 } }
        let end = hit.b % 1440
        let clock = end == 0 ? "midnight" : String(format: "%02d:%02d", end / 60, end % 60)
        return OpenState(open: true, until: always ? nil : clock)
    }

    // ── the cards ────────────────────────────────────────────────────────────

    enum Kind: String, Sendable { case openNow = "open-now", near, yearAgo = "year-ago", forgotten }

    /// What a card's button does. There is one: open the map. It carries NO
    /// URL — the screen builds the link, because only the device knows what it
    /// can open (see Facts / mapUrl).
    struct Action: Equatable, Sendable {
        let type: String
        let label: String
        static let map = Action(type: "map", label: "Map")
    }

    struct Card: Equatable, Sendable, Identifiable {
        let kind: Kind
        let item: Item
        /// One plain line saying why this card is here.
        let reason: String
        /// Present on `.openNow` and `.near` only. A memory has no Map button.
        let action: Action?
        var id: String { item.id }
    }

    // To the nearest 50 m: a phone's fix is not better than that, and "437 m"
    // claims a precision nobody has.
    private static func distance(_ m: Double) -> String {
        let r = max(50, JSCompat.round(m / 50) * 50)
        return r >= 1000 ? "1 km from you" : "\(Int(r)) m from you"
    }

    private static func nearReason(_ m: Double, _ state: OpenState?) -> String {
        guard let state else { return distance(m) }
        if !state.open { return "\(distance(m)) · closed now" }
        return "\(distance(m)) · \(state.until.map { "open until \($0)" } ?? "open 24 hours")"
    }

    private static let months = ["January", "February", "March", "April", "May", "June", "July",
                                 "August", "September", "October", "November", "December"]

    /// What to put in front of somebody, best first, at most `limit`.
    ///
    /// `seen` is the ids shown recently — the caller keeps that list, because
    /// what counts as recently is a decision about a screen and not a shelf.
    ///
    /// `timeZone` is the phone's. It decides which local day `now` is (the
    /// forgotten card turns at the person's midnight, not UTC's), which
    /// weekday the opening hours are read on, and what "today" means.
    static func surface(_ items: [Item], now: Date, here: LatLng? = nil, limit: Int = 3, seen: [String] = [],
                        timeZone: TimeZone = .current) -> [Card] {
        let nowMs = JSCompat.ms(now)
        // `add` is the ONE place an id is checked, for `seen` and for doubles alike.
        var used = Set(seen)
        var out: [Card] = []
        func add(_ card: Card) { if used.insert(card.item.id).inserted { out.append(card) } }
        // Only what has been resolved and filed. A pending row is not a memory
        // yet, and a row with no id cannot be opened, skipped or told apart.
        let filed = items.filter { $0.status == .filed && !$0.id.isEmpty }

        // 1. NEAR. Anything with a pin — the shelf it sits on is not the test,
        // the coordinates are. Open first, then unknown, then closed; nearest
        // first inside each. A closed place is still shown, and SAYS it is
        // closed. No `here` measures as nil to everything and finds nothing.
        func rank(_ s: OpenState?) -> Int { s.map { $0.open ? 0 : 2 } ?? 1 }
        let near = filed.compactMap { item -> (item: Item, m: Double, state: OpenState?)? in
            guard let m = metresBetween(here, LatLng(item.canonical)), m <= walkM else { return nil }
            // Hours are read through `String(value)`, as JS does: a missing
            // key is no hours, and anything odd is a string that will not parse.
            let hours = item.canonical["opening_hours"]
            return (item, m, openState(hours == nil ? nil : JSCompat.string(hours), now: now, timeZone: timeZone))
        }
        for x in stable(near, by: { (rank($0.state), $0.m) < (rank($1.state), $1.m) }) {
            add(Card(kind: x.state?.open == true ? .openNow : .near, item: x.item, reason: nearReason(x.m, x.state), action: .map))
        }

        // 2. A YEAR AGO, and two, and three. Closest to the day first.
        let today = JSCompat.local(nowMs, timeZone)
        var years: [(item: Item, n: Int, off: Double, today: Bool)] = []
        for item in filed {
            guard let savedMs = JSCompat.parseDate(item.createdAt, timeZone) else { continue }
            let saved = JSCompat.local(savedMs, timeZone)
            for n in 1...3 {
                // `setFullYear`: the same LOCAL month, day and time, n years
                // on. 29 February in a common year rolls to 1 March.
                let dueDays = JSCompat.days(year: saved.year + n, month: saved.month, day: saved.day)
                let dueMs = JSCompat.utc(fromLocalMs: Double(dueDays) * JSCompat.dayMs + saved.msOfDay, timeZone)
                let off = abs(nowMs - dueMs)
                guard off <= weekHalfMs else { continue }
                let due = JSCompat.local(dueMs, timeZone)
                years.append((item, n, off, due.year == today.year && due.month == today.month && due.day == today.day))
            }
        }
        for y in stable(years, by: { ($0.off, $0.n) < ($1.off, $1.n) }) {
            add(Card(kind: .yearAgo, item: y.item,
                     reason: "Saved \(y.n == 1 ? "a year" : "\(y.n) years") ago \(y.today ? "today" : "this week")", action: nil))
        }

        // 3. FORGOTTEN. Oldest first, then turned by the day number, so
        // tomorrow starts one further along and the whole pile comes round.
        // Cards already out, and `seen`, leave the pile BEFORE it is turned:
        // the turn has to count what can actually be shown, or two days share
        // a lead.
        let pile = filed.compactMap { item -> (item: Item, saved: Double)? in
            guard !used.contains(item.id), JSCompat.trim(item.note).isEmpty,
                  let saved = JSCompat.parseDate(item.createdAt, timeZone),
                  nowMs - saved >= forgottenDays * JSCompat.dayMs else { return nil }
            return (item, saved)
        }
        // THE ONE COMPARISON THAT IS THE PLATFORM'S: JS breaks a tie on the
        // same millisecond with `localeCompare`, which is the device's
        // collation. Here it is English collation, fixed, so the order does
        // not move with the phone's language.
        let english = Locale(identifier: "en_US")
        let old = stable(pile) { a, b in
            a.saved != b.saved ? a.saved < b.saved : a.item.id.compare(b.item.id, options: [], range: nil, locale: english) == .orderedAscending
        }
        if !old.isEmpty {
            // The LOCAL day, so the card changes at the person's midnight, not UTC's.
            let day = Int(((nowMs + JSCompat.offsetMs(at: nowMs, timeZone)) / JSCompat.dayMs).rounded(.down))
            let turn = ((day % old.count) + old.count) % old.count
            for x in old[turn...] + old[..<turn] {
                let saved = JSCompat.local(x.saved, timeZone)
                add(Card(kind: .forgotten, item: x.item, reason: "Saved in \(months[saved.month - 1]) \(saved.year), no note yet", action: nil))
            }
        }

        return Array(out.prefix(max(0, limit)))
    }

    /// A STABLE sort, which `Array.sort` does not promise and JS's does: equal
    /// cards must stay in shelf order, or the same shelf gives two answers.
    private static func stable<T>(_ a: [T], by less: (T, T) -> Bool) -> [T] {
        a.enumerated().sorted { less($0.element, $1.element) || (!less($1.element, $0.element) && $0.offset < $1.offset) }.map(\.element)
    }
}
