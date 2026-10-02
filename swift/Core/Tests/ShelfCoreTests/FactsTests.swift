// FactsTests.swift — Facts.swift against the real facts.js (golden-facts.json),
// plus the rules of app/facts-selftest.mjs.
import XCTest
@testable import ShelfCore

final class FactsTests: XCTestCase {
    private let stJohn = logicItem("sj", "restaurants", "St. John", canonical: [
        "lat": 51.5203, "lng": -0.1027, "city": "London", "address": "26 St John St", "opening_hours": "Mo-Sa 12:00-23:00", "cuisine": ["British"],
        // The Android link the server stores. Kept, and never read.
        "map_url": "geo:51.5203,-0.1027?q=St.%20John",
    ])
    private let bookBar = logicItem("bb", "places", "Book Bar", canonical: ["city": "London", "located": false])

    private func shirt(_ list: String, _ extra: [String: Any?] = [:]) -> Item {
        var c: [String: Any?] = ["kind": "product", "price": 65, "currency": "GBP", "price_text": "£65", "brand": "Northfield",
                                 "availability": "in_stock", "seller": "Northfield", "shop_url": "https://shop.example/overshirt"]
        for (k, v) in extra { c[k] = v }
        return logicItem("w", list, "Wool overshirt", canonical: c)
    }

    // ── golden parity ────────────────────────────────────────────────────────
    func testGoldenFactsForEveryItemOnEveryPlatform() throws {
        let g = try LogicGolden.load("golden-facts")
        let items = try LogicGolden.items(g["items"])
        let cases = LogicGolden.cases(g, "factsFor")
        XCTAssertGreaterThanOrEqual(cases.count, items.count * 3, "every item × ios, android and the web")
        var maps = 0
        for c in cases {
            let it = try XCTUnwrap(items.first { $0.id == c.input["id"]?.string })
            let platform = c.input["platform"]?.string.flatMap(Facts.Platform.init(rawValue:))
            let f = Facts.for(it, platform: platform, price: c.input["price"]?.bool ?? true)
            let map = Facts.mapURL(it, platform: platform)
            if map != nil { maps += 1 }
            let got: JSONValue = .object([
                "lede": LogicGolden.string(f.lede),
                "rows": .array(f.rows.map { .object(["label": .string($0.label), "value": .string($0.value)]) }),
                "links": .array(f.links.map { .object(["label": .string($0.label), "url": .string($0.url)]) }),
                "map": LogicGolden.string(map),
            ])
            LogicGolden.same(got, c.output, "factsFor \(it.id) on \(platform?.rawValue ?? "web") price:\(c.input["price"]?.bool ?? true)")
        }
        XCTAssertGreaterThan(maps, 60, "the fixture shelf really has map links to compare")
    }

    func testGoldenHasFactsAndStock() throws {
        let g = try LogicGolden.load("golden-facts")
        let items = try LogicGolden.items(g["items"])
        for c in LogicGolden.cases(g, "hasFacts") {
            let it = try XCTUnwrap(items.first { $0.id == c.input["id"]?.string })
            LogicGolden.same(.bool(Facts.has(it)), c.output, "hasFacts \(it.id)")
        }
        LogicGolden.same(.object(Facts.stock.mapValues(JSONValue.string)), g["stock"] ?? .null, "STOCK")
    }

    // ── the rules, from facts-selftest.mjs ───────────────────────────────────
    func testIOSMustNeverBeHandedAGeoURI() throws {
        // `geo:` is Android-only. iOS silently opens nothing, which is how the
        // restaurant Map button and "Find on map" both shipped dead on an iPhone.
        for it in [stJohn, bookBar] {
            let ios = try XCTUnwrap(Facts.mapURL(it, platform: .ios))
            XCTAssertFalse(ios.hasPrefix("geo:"), "\(it.title ?? ""): iOS must never be handed a geo: URI")
            XCTAssertTrue(ios.hasPrefix("https://maps.apple.com/"), "\(it.title ?? ""): iOS gets an Apple Maps link")
            let viaFacts = Facts.for(it, platform: .ios).links.first { $0.label == "Map" || $0.label == "Find on map" }
            XCTAssertEqual(viaFacts?.url, ios, "and the Map link on the item page is that same link")
        }
    }

    func testAndroidKeepsGeoAndTheWebGetsHttps() throws {
        XCTAssertEqual(Facts.mapURL(stJohn, platform: .android), "geo:51.5203,-0.1027?q=St.%20John", "Android keeps geo:, on the pin")
        XCTAssertEqual(Facts.mapURL(bookBar, platform: .android), "geo:0,0?q=Book%20Bar%2C%20London", "Android, no pin: a search")
        // Neither phone: the public page. A geo: link in a browser is a dead link.
        for it in [stJohn, bookBar] {
            XCTAssertTrue(try XCTUnwrap(Facts.mapURL(it, platform: nil)).hasPrefix("https://"), "the web gets an https map")
        }
    }

    func testALocatedPlaceOpensOnThePinAndAnUnlocatedOneSearches() throws {
        XCTAssertTrue(try XCTUnwrap(Facts.mapURL(stJohn, platform: .ios)).contains("ll=51.5203,-0.1027"), "a located place opens ON the pin")
        XCTAssertTrue(try XCTUnwrap(Facts.mapURL(bookBar, platform: .ios)).contains("Book%20Bar%2C%20London"), "an unlocated one searches for name + city")
        XCTAssertNil(Facts.mapURL(logicItem("x", "places", "", canonical: [:]), platform: .ios), "nothing to search for → no link at all")
    }

    func testPercentEncodingIsEncodeURIComponent() {
        XCTAssertEqual(Facts.encodeURIComponent("Tom's Kitchen & Bar, Chelsea"), "Tom's%20Kitchen%20%26%20Bar%2C%20Chelsea")
        XCTAssertEqual(Facts.encodeURIComponent("Café (été) *~!_-."), "Caf%C3%A9%20(%C3%A9t%C3%A9)%20*~!_-.")
        XCTAssertEqual(Facts.encodeURIComponent("a/b?c#d=e+f%g"), "a%2Fb%3Fc%23d%3De%2Bf%25g")
    }

    func testNeverARowWithAnEmptyValue() {
        let r = Facts.for(stJohn, platform: .ios)
        XCTAssertTrue(r.rows.contains { $0.label == "Address" }, "a restaurant shows its address")
        XCTAssertTrue(r.links.contains { $0.label == "Map" }, "and a Map link")
        let bare = logicItem("b", "movies", "Bare", canonical: ["runtime_min": nil, "genres": [Any?](), "cast": [""], "overview": "", "trailer_url": "", "rating": "7"])
        let f = Facts.for(bare)
        XCTAssertTrue(f.rows.isEmpty && f.links.isEmpty && f.lede == nil, "RULE 1: nothing with no value is drawn — \(f)")
    }

    func testAnUnlocatedPlaceSaysFindOnMap() {
        XCTAssertTrue(Facts.for(bookBar, platform: .ios).links.contains { $0.label == "Find on map" },
                      "labelling it Map makes an approximate result feel broken")
        let located = logicItem("l", "places", "Belém", canonical: ["city": "Lisbon", "located": true])
        XCTAssertTrue(Facts.for(located, platform: .ios).links.contains { $0.label == "Map" })
    }

    func testAQuoteAndHasFacts() {
        XCTAssertEqual(Facts.for(logicItem("q", "quotes", "x", canonical: ["author": "Lily Tomlin"])).rows, [Facts.Row(label: "Said by", value: "Lily Tomlin")],
                       "a quote's facts are who said it, and not the quote printed twice")
        XCTAssertTrue(Facts.has(stJohn))
        XCTAssertFalse(Facts.has(logicItem("b", "books", "x")), "hasFacts saves drawing a rule above nothing")
    }

    func testAThingToBuy() {
        // The same rows wherever it stands: on a build with no Wishlist shelf it
        // is in the pile as "unsorted", and it must still say what it costs.
        for list in ["wishlist", "unsorted"] {
            let p = Facts.for(shirt(list))
            XCTAssertEqual(p.rows.first, Facts.Row(label: "Price", value: "£65"), "\(list): the price is the first row")
            XCTAssertTrue(p.links.contains(Facts.Link(label: "Open the shop", url: "https://shop.example/overshirt")), "\(list): and the shop opens")
        }
        // THE ITEM PAGE SAYS THE PRICE ONCE: it draws it large and asks for the
        // table without it. The rest of the rows must be untouched.
        let p = Facts.for(shirt("wishlist", ["seller": "Liberty"]), price: false)
        XCTAssertEqual(p.rows.map(\.label), ["Brand", "Stock", "Sold by"], "price:false leaves the Price row out and keeps the rest")
        XCTAssertEqual(Facts.for(shirt("wishlist"), platform: .ios).rows.first?.label, "Price", "any other option leaves the price where it was")
        XCTAssertEqual(Facts.stock["in_stock"], "In stock")
        XCTAssertEqual(Facts.stock["out_of_stock"], "Sold out")
        XCTAssertFalse(Facts.for(shirt("wishlist", ["price": nil, "price_text": nil])).rows.contains { $0.label == "Price" }, "no price → no Price row, never a guess or a dash")
        XCTAssertTrue(Facts.for(shirt("wishlist", ["availability": "out_of_stock"])).rows.contains { $0.value == "Sold out" }, "stock is said in plain words")
        XCTAssertFalse(Facts.for(shirt("wishlist")).rows.contains { $0.label == "Sold by" }, "the seller is not repeated when it is the brand")
        XCTAssertTrue(Facts.for(shirt("wishlist", ["seller": "Liberty"])).rows.contains(Facts.Row(label: "Sold by", value: "Liberty")), "a different seller is named")
        XCTAssertFalse(Facts.for(logicItem("b", "books", "x", canonical: ["price_text": "£9"])).rows.contains { $0.label == "Price" },
                       "a price on something that is not a product is not shown — only kind:product is a thing to buy")
    }
}
