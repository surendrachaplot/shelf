// ListsLogic.swift — a list somebody made: the things they put on it, and a
// search they kept. Port of app/src/lists.js, checked against golden-lists.json.
//
// A moodboard, a wishlist and a trip are all this one thing; the only
// difference is `view`. In the file these are `shelf.boards` (`list` on an
// ITEM already means its shelf). On screen the word is "Lists".
//
// THREE RULES:
//
// 1. NOTHING HERE CHANGES WHAT IT IS GIVEN. Every operation returns the lists
//    as they should now be — EQUAL to what came in when there was nothing to
//    do (an unknown list, a pin already there, an empty name). So the caller
//    can compare with `==` and skip a save that would write the same bytes.
// 2. A PIN IS AN ID, AND AN ID CAN OUTLIVE ITS ITEM. `items(of:in:)` skips a
//    pin whose item is gone; it does not draw a hole. The pin itself stays:
//    ids are made from the source link, so a thing removed and shared again
//    comes back with the same id — and back onto every list it was on.
//    `prune` is the only thing that forgets a pin.
// 3. TWO CURRENCIES ARE NEVER ONE NUMBER. There is no exchange rate on a phone
//    with no network, and a total that adds pounds to yen means nothing. One
//    line per currency.
import Foundation

enum ListsLogic {
    /// Long enough for "Things to do in Lisbon with my parents", short enough for one line.
    static let nameMax = 60
    static let views: [Board.View] = [.pictures, .rows]

    // Cut by CODE POINT, not by UTF-16 unit: a cut through the middle of an
    // emoji leaves half of one, which draws as a box.
    private static func cleanName(_ name: String?) -> String {
        let flat = JSLogic.trim(JSLogic.squash(name ?? ""))
        return JSLogic.trim(String(String.UnicodeScalarView(flat.unicodeScalars.prefix(nameMax))))
    }

    // "No saved search" is nil and only nil. An empty string would be a third
    // state that every reader has to remember to treat as the second.
    private static func cleanQuery(_ q: String?) -> String? {
        let t = JSLogic.trim(q ?? "")
        return t.isEmpty ? nil : t
    }

    private static func newId() -> String {
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        let random = String((0..<10).map { _ in alphabet.randomElement()! })
        return "l_" + random + String(Int64(Date().timeIntervalSince1970 * 1000), radix: 36)
    }

    /// `new Date(x).toISOString()`: "2026-01-01T00:00:00.000Z".
    static func isoString(_ date: Date) -> String { date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)) }

    /// A new, empty list — or nil when there is no name to give it.
    /// `id` and `now` are handed in so a test can say what they are.
    static func make(name: String?, id: String? = nil, now: Date = Date()) -> Board? {
        let clean = cleanName(name)
        if clean.isEmpty { return nil }
        return Board(id: (id ?? "").isEmpty ? newId() : id!, name: clean, pins: [], query: nil, view: .pictures, createdAt: isoString(now))
    }

    /// Replace one list with what `fn` makes of it.
    private static func change(_ lists: [Board], _ id: String, _ fn: (Board) -> Board) -> [Board] {
        guard let at = lists.firstIndex(where: { $0.id == id }) else { return lists }
        var out = lists
        out[at] = fn(lists[at])
        return out
    }

    /// An empty name is refused, not saved: the list keeps the name it had.
    static func rename(_ lists: [Board], id: String, name: String?) -> [Board] {
        let clean = cleanName(name)
        return change(lists, id) { l in
            var l = l
            if !clean.isEmpty { l.name = clean }
            return l
        }
    }

    static func remove(_ lists: [Board], id: String) -> [Board] { lists.filter { $0.id != id } }

    static func setView(_ lists: [Board], id: String, view: Board.View) -> [Board] {
        change(lists, id) { l in var l = l; l.view = view; return l }
    }

    /// A blank search is no search.
    static func setQuery(_ lists: [Board], id: String, query: String?) -> [Board] {
        change(lists, id) { l in var l = l; l.query = cleanQuery(query); return l }
    }

    /// New pins go on the END: the order is the person's, and adding must not
    /// move what they arranged.
    static func pin(_ lists: [Board], id: String, itemId: String) -> [Board] {
        if itemId.isEmpty { return lists }
        return change(lists, id) { l in
            var l = l
            if !l.pins.contains(itemId) { l.pins.append(itemId) }
            return l
        }
    }

    static func unpin(_ lists: [Board], id: String, itemId: String) -> [Board] {
        change(lists, id) { l in var l = l; l.pins.removeAll { $0 == itemId }; return l }
    }

    static func togglePin(_ lists: [Board], id: String, itemId: String) -> [Board] {
        let on = lists.first { $0.id == id }?.pins.contains(itemId) ?? false
        return on ? unpin(lists, id: id, itemId: itemId) : pin(lists, id: id, itemId: itemId)
    }

    /// Put a pin at a position. `toIndex` is where it ENDS UP, counted after it
    /// has been lifted out — the number a drag hands you. Past either end is
    /// the end.
    static func movePin(_ lists: [Board], id: String, itemId: String, toIndex: Int) -> [Board] {
        change(lists, id) { l in
            guard let from = l.pins.firstIndex(of: itemId) else { return l }
            let to = max(0, min(l.pins.count - 1, toIndex))
            if to == from { return l }
            var l = l
            l.pins.remove(at: from)
            l.pins.insert(itemId, at: to)
            return l
        }
    }

    /// What is on a list: the pins, in the order the person put them, then
    /// everything the saved search finds that is not pinned already.
    ///
    /// Pins come first because they are a decision and the search is a guess.
    /// The search half is in Find's own order and is NOT capped: Find shows the
    /// best sixty because it is a box you are still typing in, and a list that
    /// quietly stopped at sixty would have a total that is wrong.
    static func items(of list: Board?, in items: [Item]) -> [Item] {
        guard let list else { return [] }
        let all = items.filter { !$0.id.isEmpty }
        var byId: [String: Item] = [:]
        for it in all { byId[it.id] = it }

        var out: [Item] = []
        var seen = Set<String>()
        func take(_ it: Item?) {
            guard let it, !seen.contains(it.id) else { return }
            seen.insert(it.id)
            out.append(it)
        }
        for id in list.pins { take(byId[id]) }
        // No query, or a blank one, is no words — and Find's answer to no
        // words is nothing, never everything.
        for hit in Find.search(items: all, query: list.query, limit: .max).hits { take(hit.item) }
        return out
    }

    /// Forget the pins whose item is gone.
    ///
    /// ONLY EVER ON A SHELF THAT WAS READ. Handed the empty shelf the app shows
    /// when the file would not open, this would take every pin off every list
    /// and the next save would make it permanent — an error turned into a
    /// statement about somebody's data. Nothing needs it to run: `items(of:in:)`
    /// skips a dead pin by itself. It is housekeeping, for when the person has
    /// asked for a clean-up.
    static func prune(_ lists: [Board], items: [Item]) -> [Board] {
        let have = Set(items.map(\.id))
        return lists.map { l in var l = l; l.pins.removeAll { !have.contains($0) }; return l }
    }

    /// The lists an item is PINNED on. A saved search finding it does not
    /// count: nobody put it there.
    static func lists(_ lists: [Board], with itemId: String) -> [Board] { lists.filter { $0.pins.contains(itemId) } }

    // ── MONEY ────────────────────────────────────────────────────────────────
    //
    // THE CONTRACT with the server: `canonical.price`, a number in the
    // currency's main unit (12.5 is twelve pounds fifty), and
    // `canonical.currency`, an ISO code ("GBP").

    struct Price: Equatable, Sendable {
        var amount: Double
        var currency: String
    }

    struct TotalLine: Equatable, Sendable {
        var currency: String
        var amount: Double
        var text: String
    }

    /// `priced` and `unpriced` are there so the screen can say "3 of 5 have a
    /// price" — a total that does not say what it left out reads as the price
    /// of everything.
    struct Total: Equatable, Sendable {
        var byCurrency: [TotalLine] = []
        var priced = 0
        var unpriced = 0
    }

    private static func isCode(_ s: String) -> Bool {
        let b = Array(s.utf8)
        return b.count == 3 && b.allSatisfy { ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) }
    }

    /// The price of one item, or nil.
    ///
    /// Nil for no price, and nil for a price that is not one: a string, a
    /// negative number. ZERO IS A PRICE — free is a thing a wishlist can say.
    ///
    /// And nil for a price with no currency. "12" is not twelve of anything,
    /// and guessing pounds because the phone is in London is how a total goes
    /// wrong.
    static func price(of item: Item) -> Price? {
        let c = item.canonical
        let currency = JSLogic.trim(JSLogic.text(c["currency"])).uppercased()
        guard let amount = JSLogic.finite(c["price"]), amount >= 0 else { return nil }
        guard isCode(currency) else { return nil }
        return Price(amount: amount, currency: currency)
    }

    // Pence in a pound: 2. Yen have none, a Kuwaiti dinar has 3.
    //
    // PINNED, not asked of the system. NumberFormatter on macOS and iOS says 0
    // for HUF and IDR; Intl in Node (ICU 77, CLDR 47) says 2, and the golden
    // file is Node's. So this is Node's whole answer: every three-letter code
    // whose smallest unit is not a hundredth. The golden test checks each one.
    private static let minor: [Int: Set<String>] = [
        0: ["ADP", "AFN", "ALL", "BIF", "BYR", "CLP", "DJF", "ESP", "GNF", "IQD", "IRR", "ISK", "ITL", "JPY", "KMF", "KPW", "KRW",
            "LAK", "LBP", "LUF", "MGA", "MGF", "MMK", "MRO", "PYG", "RSD", "RWF", "SLL", "SOS", "STD", "SYP", "TMM", "TRL", "UGX",
            "UYI", "VND", "VUV", "XAF", "XOF", "XPF", "YER", "ZMK", "ZWD"],
        3: ["BHD", "JOD", "KWD", "LYD", "OMR", "TND"],
        4: ["CLF", "UYW"],
    ]

    static func minorDigits(_ currency: String) -> Int {
        let code = currency.uppercased()
        return minor.first { $0.value.contains(code) }?.key ?? 2
    }

    /// JS `Math.round`: a half goes UP, also below zero.
    private static func jsRound(_ x: Double) -> Double {
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    /// JS `x.toFixed(digits)`: the exact value, a half going away from zero.
    private static func toFixed(_ x: Double, _ digits: Int) -> String {
        let a = abs(x)
        // printf rounds an exact half to the even digit; JS takes the larger.
        // A half is exact only when everything after it is zero.
        let exact = String(format: "%.40f", a)
        let tail = exact.drop { $0 != "." }.dropFirst().dropFirst(digits)
        let half = tail.first == "5" && tail.dropFirst().allSatisfy { $0 == "0" }
        return (x < 0 ? "-" : "") + String(format: "%.\(digits)f", half ? a.nextUp : a)
    }

    /// "£12.50", and "£12" — not "£12.00" — when there is nothing after the
    /// point. Written the way `locale` writes money (en-GB: "US$20", "€1,299").
    ///
    /// A code that is not three letters cannot be formatted; that gives the
    /// code and the number ("POUNDS 12"), as the JS does.
    static func priceText(_ amount: Double, _ currency: String, locale: Locale = .current) -> String {
        let d = isCode(currency) ? minorDigits(currency) : 2
        let unit = pow(10, Double(d))
        let digits = jsRound(amount * unit).truncatingRemainder(dividingBy: unit) == 0 ? 0 : d
        let plain = "\(currency) \(toFixed(amount, digits))"
        guard isCode(currency) else { return plain }
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .currency
        f.currencyCode = currency.uppercased()
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        // Intl rounds a half away from zero; NumberFormatter's default is to even.
        f.roundingMode = .halfUp
        return f.string(from: NSNumber(value: amount)) ?? plain
    }

    /// What one item costs, AS IT IS SHOWN, or nil.
    ///
    /// ONE formatter for a jacket, a row, an item page and the total under
    /// them. The server's text says "£65.00" and a total says "£83"; side by
    /// side that reads as two apps. The server's text is kept only for what a
    /// single number cannot say — a range ("$20 to $35") — or when there is no
    /// currency to format with.
    static func priceOn(_ item: Item, locale: Locale = .current) -> String? {
        let said = item.canonical["price_text"]?.string
        if let said, said.contains(" to ") { return said }
        if let p = price(of: item) { return priceText(p.amount, p.currency, locale: locale) }
        return (said ?? "").isEmpty ? nil : said
    }

    /// What a run of items comes to.
    ///
    /// One line per currency, largest amount first (the code breaks a tie, so
    /// two lines do not swap places between two reads).
    ///
    /// SUMMED IN PENCE. 0.1 + 0.2 is 0.30000000000000004 in every language
    /// that has floats, and a total is the one number on the screen somebody
    /// will check with a calculator.
    static func shelfTotal(_ items: [Item], locale: Locale = .current) -> Total {
        var order: [String] = []
        var by: [String: [Double]] = [:]
        var total = Total()
        for it in items {
            guard let p = price(of: it) else { total.unpriced += 1; continue }
            total.priced += 1
            if by[p.currency] == nil { order.append(p.currency) }
            by[p.currency, default: []].append(p.amount)
        }
        total.byCurrency = order.map { currency in
            let unit = pow(10, Double(minorDigits(currency)))
            let amount = (by[currency] ?? []).reduce(0) { $0 + jsRound($1 * unit) } / unit
            return TotalLine(currency: currency, amount: amount, text: priceText(amount, currency, locale: locale))
        }
        total.byCurrency.sort { a, b in a.amount != b.amount ? a.amount > b.amount : a.currency < b.currency }
        return total
    }

    /// The total of one list: its pins and whatever its saved search finds.
    static func total(of list: Board?, in items: [Item], locale: Locale = .current) -> Total {
        shelfTotal(self.items(of: list, in: items), locale: locale)
    }
}
