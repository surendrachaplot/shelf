// Facts.swift — what a catalogue knows, in the order a person wants it.
// Port of app/src/facts.js, checked against golden-facts.json.
//
// TWO RULES, both learned from screens that ignored them:
//
// 1. NEVER DRAW AN EMPTY FIELD. A row reading "Runtime —" looks like broken
//    data, not absent data. Everything here is dropped unless it has a value.
// 2. ORDER BY WHAT DECIDES SOMETHING. A film's runtime settles "can I watch
//    this tonight"; its cast rarely does. Not alphabetical, not the API's order.
import Foundation

enum Facts {
    /// Which phone is asking. `nil` is the public web page.
    enum Platform: String, Sendable { case ios, android }

    struct Row: Equatable, Sendable {
        var label: String
        var value: String
    }

    struct Link: Equatable, Sendable {
        var label: String
        var url: String
    }

    struct Result: Equatable, Sendable {
        var lede: String?
        var rows: [Row]
        var links: [Link]
    }

    // Said the way a person would say it. "preorder" is not a state anybody
    // recognises on a label; "Not out yet" is.
    static let stock = ["in_stock": "In stock", "out_of_stock": "Sold out", "preorder": "Not out yet"]

    /// JS `encodeURIComponent`: everything but A–Z a–z 0–9 - _ . ! ~ * ' ( )
    /// becomes %XX of its UTF-8 bytes.
    static func encodeURIComponent(_ s: String) -> String {
        let hex = Array("0123456789ABCDEF".utf8)
        var out = [UInt8]()
        for b in s.utf8 {
            switch b {
            case 65...90, 97...122, 48...57, 45, 95, 46, 33, 126, 42, 39, 40, 41: out.append(b)
            default: out += [37, hex[Int(b >> 4)], hex[Int(b & 15)]]
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// A MAP LINK THE PHONE WILL ACTUALLY OPEN.
    ///
    /// `geo:` is an ANDROID scheme. iOS does not handle it, so a Map button
    /// built from it opens nothing on an iPhone, silently. So the server stores
    /// the facts — a name, a city, a pin — and the DEVICE builds the link,
    /// because only the device knows what it can open. `canonical.map_url` is
    /// the Android form and is never read.
    ///
    /// `nil` is not a phone at all: the public page, where a `geo:` link is a
    /// dead link. That gets a plain https maps URL, which works everywhere.
    static func mapURL(_ item: Item, platform: Platform?) -> String? {
        let c = item.canonical
        let name = item.title ?? ""
        let q = [name, JSLogic.truthy(c["city"]) ? JSLogic.text(c["city"]) : ""].filter { !$0.isEmpty }.joined(separator: ", ")
        var pin: String?
        if let lat = JSLogic.finite(c["lat"]), let lng = JSLogic.finite(c["lng"]) { pin = "\(JSLogic.number(lat)),\(JSLogic.number(lng))" }
        if q.isEmpty, pin == nil { return nil }
        let label = encodeURIComponent(name.isEmpty ? q : name)
        let search = encodeURIComponent(q)

        switch platform {
        case .ios:
            // Apple Maps opens on the pin AND keeps the name on it, which is
            // why both go in rather than just the coordinates.
            if let pin { return "https://maps.apple.com/?ll=\(pin)&q=\(label)" }
            return "https://maps.apple.com/?q=\(search)"
        case .android:
            // geo: and not a Google Maps URL: it opens whichever map app the
            // person actually uses.
            if let pin { return "geo:\(pin)?q=\(label)" }
            return "geo:0,0?q=\(search)"
        case nil:
            return "https://www.google.com/maps/search/?api=1&query=\(pin ?? search)"
        }
    }

    /// The lede, rows and links of one item.
    ///
    /// `price: false` leaves the Price row out, for a screen that has already
    /// drawn the price somewhere larger (the item page's price block).
    static func `for`(_ item: Item, platform: Platform? = nil, price: Bool = true) -> Result {
        let c = item.canonical
        var rows: [Row] = []
        var links: [Link] = []
        var lede: String?

        func row(_ label: String, _ v: JSONValue?) { if JSLogic.truthy(v) { rows.append(Row(label: label, value: JSLogic.text(v))) } }
        func row(_ label: String, text: String?) { if let text, !text.isEmpty { rows.append(Row(label: label, value: text)) } }
        func link(_ label: String, _ v: JSONValue?) { if JSLogic.truthy(v) { links.append(Link(label: label, url: JSLogic.text(v))) } }
        func link(_ label: String, text: String?) { if let text, !text.isEmpty { links.append(Link(label: label, url: text)) } }
        /// The parts of an array that are something, as JS would print each.
        func list(_ v: JSONValue?) -> [String] { (v?.array ?? []).filter { JSLogic.truthy($0) }.map { JSLogic.text($0) } }
        func num(_ v: JSONValue?) -> String? { JSLogic.finite(v).map(JSLogic.number) }

        // A THING TO BUY. Keyed on what the item IS, not on which shelf it
        // stands on: a product is a product on the Wishlist shelf, in the pile,
        // or pinned to a list. The price comes first because it is the one
        // fact that decides. No price → no row, never "Price: unknown".
        if c["kind"]?.string == "product" {
            if price { row("Price", c["price_text"]) }
            row("Brand", c["brand"])
            row("Stock", text: stock[JSLogic.text(c["availability"])])
            // The seller is not repeated when it is the brand.
            if JSLogic.truthy(c["seller"]), !strictEqual(c["seller"], c["brand"]) { row("Sold by", c["seller"]) }
            link("Open the shop", c["shop_url"])
        } else if item.list == "movies" {
            lede = JSLogic.truthy(c["overview"]) ? JSLogic.text(c["overview"]) : nil
            row("Runtime", text: num(c["runtime_min"]).map { "\($0) min" })
            row("Rating", text: num(c["rating"]).map { "\($0) / 10" })
            row("Genre", text: list(c["genres"]).joined(separator: " · "))
            row("With", text: list(c["cast"]).joined(separator: ", "))
            link("Trailer", c["trailer_url"])
            // The provider names ARE the label. "Where to watch" makes you tap
            // to find out; "On Mubi, Netflix" has already answered.
            let on = list(c["streaming"])
            link(on.isEmpty ? "Where to watch" : "On \(on.joined(separator: ", "))", c["watch_url"])
        } else if item.list == "books" {
            // The opening line, not a blurb: the best single test of whether
            // you want the book.
            lede = JSLogic.truthy(c["first_sentence"]) ? "“\(JSLogic.text(c["first_sentence"]))”" : nil
            row("Author", c["author"])
            row("First published", c["year"])
            row("Length", text: num(c["pages"]).map { "\($0) pages" })
            row("Rating", text: num(c["rating"]).map { "\($0) / 5" })
            row("Shelved as", text: list(c["subjects"]).joined(separator: " · "))
            link("Open Library", c["read_url"])
        } else if item.list == "restaurants" {
            row("Address", c["address"])
            row("Open", c["opening_hours"])
            row("Serves", text: list(c["cuisine"]).joined(separator: " · "))
            link("Map", text: mapURL(item, platform: platform))
            link("Website", c["website"])
            link("Call", text: JSLogic.truthy(c["phone"]) ? "tel:" + JSLogic.squash(JSLogic.text(c["phone"]), with: "") : nil)
        } else if item.list == "quotes" {
            // A quote's facts are almost nothing, and that is right: the words
            // are on the jacket already. What is worth saying is WHO, and where.
            row("Said by", c["author"])
            row("From", c["source"])
        } else if item.list == "places" {
            // The area, then the city — and once, when they are the same word.
            var wheres: [String] = []
            if JSLogic.truthy(c["area"]) { wheres.append(JSLogic.text(c["area"])) }
            if JSLogic.truthy(c["city"]), !(JSLogic.truthy(c["area"]) && strictEqual(c["area"], c["city"])) { wheres.append(JSLogic.text(c["city"])) }
            row("Where", text: wheres.joined(separator: " · "))
            row("Address", c["address"])
            row("Open", c["opening_hours"])
            // TWO DIFFERENT PROMISES, said differently. A located place opens
            // the map ON it; an unlocated one opens a search that should find
            // it. Calling both "Map" makes the second feel broken the first
            // time it lands you somewhere approximate.
            link(c["located"] == .bool(false) ? "Find on map" : "Map", text: mapURL(item, platform: platform))
            link("Website", c["website"])
        } else if item.list == "recipes" {
            row("Takes", c["total_time"])
            row("Serves", c["serves"])
            row("Steps", text: num(c["steps"]))
            let ingredients = list(c["ingredients"]).count
            row("Ingredients", text: ingredients > 0 ? String(ingredients) : nil)
            row("Per serving", c["calories"])
            row("By", c["author"])
            link("Full recipe", c["recipe_url"])
        }
        return Result(lede: lede, rows: rows, links: links)
    }

    /// Is there anything at all to draw? Saves drawing a rule above nothing.
    static func has(_ item: Item) -> Bool {
        let f = self.for(item)
        return f.lede != nil || !f.rows.isEmpty || !f.links.isEmpty
    }

    /// JS `a === b`: two strings, numbers or booleans with the same value. Two
    /// arrays or two objects are never the same thing.
    private static func strictEqual(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
        switch (a ?? .null, b ?? .null) {
        case (.string(let x), .string(let y)): return JSLogic.same(x, y)
        case (.number(let x), .number(let y)): return x == y
        case (.bool(let x), .bool(let y)): return x == y
        case (.null, .null): return a == nil && b == nil || a == .null && b == .null
        default: return false
        }
    }
}
