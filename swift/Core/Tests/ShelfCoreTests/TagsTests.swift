// TagsTests.swift — Tags.swift against the real tags.js (golden-tags.json),
// plus the rules of app/tags-selftest.mjs.
//
// The golden files are written by `node swift/tools/golden/logic.mjs`.
import XCTest
@testable import ShelfCore

/// Shared by the five logic test files (Tags, Links, Facts, Find, ListsLogic).
enum LogicGolden {
    /// A golden file. `SHELF_GOLDEN_DIR` points the tests at a scratch copy, so
    /// a probe can spoil one expected value and watch the test fail without
    /// touching the real file.
    static func load(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> JSONValue {
        let url: URL
        if let dir = ProcessInfo.processInfo.environment["SHELF_GOLDEN_DIR"] {
            url = URL(fileURLWithPath: dir).appendingPathComponent(name + ".json")
        } else {
            url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"), file: file, line: line)
        }
        return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    }

    static func items(_ v: JSONValue?) throws -> [Item] { try JSONDecoder().decode([Item].self, from: JSONEncoder().encode(v ?? .array([]))) }
    static func boards(_ v: JSONValue?) throws -> [Board] { try JSONDecoder().decode([Board].self, from: JSONEncoder().encode(v ?? .array([]))) }

    /// The `{ input, output }` cases under one key. Never empty: a golden test
    /// that ran over nothing would pass, and prove nothing.
    static func cases(_ g: JSONValue, _ key: String, file: StaticString = #filePath, line: UInt = #line) -> [(input: JSONValue, output: JSONValue)] {
        let all = (g[key]?.array ?? []).map { (input: $0["input"] ?? .null, output: $0["output"] ?? .null) }
        XCTAssertFalse(all.isEmpty, "\(key): no golden cases", file: file, line: line)
        return all
    }

    /// Where two JSON values first differ, or nil when they are the same.
    /// Strings are compared unit by unit (Swift's `==` calls "é" and
    /// "e + accent" equal, and JS does not); numbers to within 1e-9.
    static func diff(_ got: JSONValue, _ want: JSONValue, _ path: String = "$") -> String? {
        switch (got, want) {
        case (.null, .null): return nil
        case (.bool(let a), .bool(let b)): return a == b ? nil : "\(path): \(a) is not \(b)"
        case (.number(let a), .number(let b)): return abs(a - b) <= 1e-9 ? nil : "\(path): \(a) is not \(b)"
        case (.string(let a), .string(let b)): return a.utf16.elementsEqual(b.utf16) ? nil : "\(path): “\(a)” is not “\(b)”"
        case (.array(let a), .array(let b)):
            if a.count != b.count { return "\(path): \(a.count) elements, not \(b.count)" }
            for (i, pair) in zip(a, b).enumerated() { if let d = diff(pair.0, pair.1, "\(path)[\(i)]") { return d } }
            return nil
        case (.object(let a), .object(let b)):
            for k in Set(a.keys).union(b.keys).sorted() {
                guard let x = a[k] else { return "\(path).\(k): missing" }
                guard let y = b[k] else { return "\(path).\(k): not expected" }
                if let d = diff(x, y, "\(path).\(k)") { return d }
            }
            return nil
        default: return "\(path): \(got) is not \(want)"
        }
    }

    static func same(_ got: JSONValue, _ want: JSONValue, _ what: @autoclosure () -> String, file: StaticString = #filePath, line: UInt = #line) {
        if let d = diff(got, want) { XCTFail("\(what()) — \(d)", file: file, line: line) }
    }

    /// A JSON value out of Swift literals, for fixtures written in a test.
    static func json(_ any: Any?) -> JSONValue {
        guard let any else { return .null }
        // By the value's own type first: on Apple platforms `1 as? Bool` is true.
        if type(of: any) == Bool.self, let v = any as? Bool { return .bool(v) }
        if let v = any as? JSONValue { return v }
        if let v = any as? String { return .string(v) }
        if let v = any as? Int { return .number(Double(v)) }
        if let v = any as? Double { return .number(v) }
        if let v = any as? [Any?] { return .array(v.map(json)) }
        if let v = any as? [String: Any?] { return .object(v.mapValues(json)) }
        return .null
    }

    static func string(_ s: String?) -> JSONValue { s.map(JSONValue.string) ?? .null }
    static func strings(_ s: [String]) -> JSONValue { .array(s.map(JSONValue.string)) }

}

/// One item, the way the JS selftests build theirs.
func logicItem(_ id: String, _ list: String, _ title: String? = nil, subtitle: String = "", note: String = "",
               canonical: [String: Any?] = [:], caption: String? = nil, created: String = "2026-01-01T00:00:00.000Z",
               status: ItemStatus = .filed) -> Item {
    Item(id: id, list: list, status: status, title: title, subtitle: subtitle, note: note, canonical: canonical.mapValues(LogicGolden.json),
         confidence: 1, enriched: true, resolver: "test", caption: caption, createdAt: created)
}

final class TagsTests: XCTestCase {
    private func tags(_ t: [Tags.Tag]) -> JSONValue {
        .array(t.map { .object(["kind": .string($0.kind), "value": .string($0.value), "key": .string($0.key)]) })
    }
    private func keys(_ it: Item) -> String { Tags.for(it).map(\.key).joined(separator: "|") }

    // ── golden parity ────────────────────────────────────────────────────────
    func testGoldenFold() throws {
        let g = try LogicGolden.load("golden-tags")
        for c in LogicGolden.cases(g, "fold") {
            let got = Tags.fold(c.input["s"]?.string, useNormalize: c.input["useNormalize"]?.bool ?? true)
            LogicGolden.same(.string(got), c.output, "fold \(c.input)")
        }
    }

    func testGoldenTagKey() throws {
        let g = try LogicGolden.load("golden-tags")
        for c in LogicGolden.cases(g, "tagKey") {
            LogicGolden.same(.string(Tags.key(kind: c.input["kind"]?.string ?? "", value: c.input["value"]?.string)), c.output, "tagKey \(c.input)")
        }
    }

    func testGoldenTagsForEveryItem() throws {
        let g = try LogicGolden.load("golden-tags")
        let items = try LogicGolden.items(g["items"])
        let cases = LogicGolden.cases(g, "tagsFor")
        XCTAssertEqual(cases.count, items.count)
        for c in cases {
            let it = try XCTUnwrap(items.first { $0.id == c.input["id"]?.string })
            LogicGolden.same(tags(Tags.for(it)), c.output, "tagsFor \(it.id)")
        }
    }

    func testGoldenTagIndexAndItemsWithTag() throws {
        let g = try LogicGolden.load("golden-tags")
        let items = try LogicGolden.items(g["items"])
        for c in LogicGolden.cases(g, "tagIndex") {
            let n = Int(c.input["count"]?.number ?? 0)
            let got = Tags.index(Array(items.prefix(n))).map { r -> JSONValue in
                .object(["key": .string(r.key), "kind": .string(r.kind), "value": .string(r.value), "count": .number(Double(r.count)), "ids": LogicGolden.strings(r.ids)])
            }
            LogicGolden.same(.array(got), c.output, "tagIndex over \(n) items")
        }
        for c in LogicGolden.cases(g, "itemsWithTag") {
            let key = c.input["key"]?.string ?? ""
            LogicGolden.same(LogicGolden.strings(Tags.items(items, withTag: key).map(\.id)), c.output, "itemsWithTag \(key)")
        }
    }

    // ── the rules, from tags-selftest.mjs ────────────────────────────────────
    func testAKeyIsKindAndFoldedValue() {
        XCTAssertEqual(Tags.key(kind: "author", value: "Susanna Clarke"), "author:susanna clarke")
        XCTAssertEqual(Tags.key(kind: "author", value: "susanna  CLARKE."), Tags.key(kind: "author", value: "Susanna Clarke"),
                       "case, spacing and a full stop are not a different author")
        XCTAssertEqual(Tags.key(kind: "city", value: "São Paulo"), "city:sao paulo", "accents fold")
        XCTAssertEqual(Tags.key(kind: "author", value: "村上春樹"), "author:村上春樹", "a name in another script survives as itself")
        XCTAssertEqual(Tags.key(kind: "author", value: " . "), "", "nothing to name → no key, never 'author:'")
        XCTAssertEqual(Tags.key(kind: "author", value: nil), "")
    }

    func testTheTablePathFoldsToo() {
        XCTAssertEqual(Tags.fold("Café de Flore", useNormalize: false), "cafe de flore")
        XCTAssertEqual(Tags.fold("Ganapati’s", useNormalize: false), "ganapati’s", "the table leaves anything it does not know alone")
        XCTAssertEqual(Tags.fold(nil), "")
    }

    func testEachShelfByTheFieldsTheServerSends() {
        let piranesi = logicItem("p", "books", "Piranesi", subtitle: "Susanna Clarke", canonical: ["year": 2020, "author": "Susanna Clarke", "subjects": ["Fantasy", "Labyrinths"], "openlibrary_key": "/works/OL1W"])
        XCTAssertEqual(keys(piranesi), "author:susanna clarke|genre:fantasy|genre:labyrinths|year:2020|decade:2020s",
                       "a book: who wrote it first, when last — and a NUMBER year still makes a year and a decade")
        XCTAssertEqual(Tags.for(piranesi)[0].value, "Susanna Clarke", "the value is as the catalogue spelled it, not the folded key")
        let sinners = logicItem("s", "movies", "Sinners", canonical: ["year": "2025", "director": "Ryan Coogler", "genres": ["Horror", "Thriller"], "cast": ["Michael B. Jordan", "Hailee Steinfeld"]])
        XCTAssertEqual(keys(sinners), "director:ryan coogler|genre:horror|genre:thriller|cast:michael b jordan|cast:hailee steinfeld|year:2025|decade:2020s",
                       "a film: director, genres, cast, and a STRING year")
        let ganapati = logicItem("g", "restaurants", "Ganapati", canonical: ["area": "Peckham", "cuisine": ["South indian", "Indian"], "address": "38 Holly Grove", "osm_id": 42])
        XCTAssertEqual(keys(ganapati), "area:peckham|cuisine:south indian|cuisine:indian", "a restaurant: where, then every cuisine in the array")
        XCTAssertEqual(keys(logicItem("bb", "places", "Book Bar", canonical: ["area": "Bounds Green", "city": "London", "cuisine": [Any?]()])), "area:bounds green|city:london")
        let dal = logicItem("d", "recipes", "Lemon dal", canonical: ["author": "Meera Sodha", "cuisine": "Indian", "total_time": "45 min", "article": ["siteName": "The Guardian", "byline": "Meera Sodha"]])
        XCTAssertEqual(keys(dal), "author:meera sodha|cuisine:indian|site:the guardian", "a recipe: a STRING cuisine is one tag, and the site is the last")
    }

    func testAQuoteReadsItsAuthorFromTheSubtitleAndABookDoesNot() {
        XCTAssertEqual(keys(logicItem("q", "quotes", "Attention is the beginning of devotion.", subtitle: "Mary Oliver")), "author:mary oliver")
        XCTAssertTrue(Tags.for(logicItem("x", "books", "Piranesi", subtitle: "Susanna Clarke · 2020")).isEmpty,
                      "a book with no canonical has NO tags — its subtitle is not a fact")
    }

    func testABrandIsATagOnlyOnAThingToBuy() {
        let shirt = logicItem("w", "wishlist", "Wool overshirt", canonical: ["kind": "product", "price": 65, "currency": "GBP", "brand": "Northfield", "shop_url": "https://shop.example/x"])
        XCTAssertEqual(keys(shirt), "brand:northfield", "a thing to buy is tagged by who makes it, and by nothing else")
        XCTAssertFalse(Tags.for(logicItem("x", "books", "x", canonical: ["brand": "Penguin"])).contains { $0.kind == "brand" },
                       "a brand on something that is not a product is not a tag")
        XCTAssertTrue(Tags.for(logicItem("n", "notes", "Brown boots", note: "Ask Maya", canonical: ["kind": "note"])).isEmpty, "a note has no tags")
    }

    func testNothingThatIsNotAFact() {
        let empties = logicItem("e", "movies", "Untitled", canonical: ["year": nil, "director": nil, "genres": [Any?](), "cast": [Any?](), "author": "", "city": "  ", "area": "", "cuisine": [""]])
        XCTAssertTrue(Tags.for(empties).isEmpty, "nulls, blanks and empty arrays give no tags at all")
        XCTAssertTrue(Tags.for(logicItem("y", "movies", canonical: ["year": ""])).isEmpty, "no year → no decade of '0s'")
        XCTAssertTrue(Tags.for(logicItem("y2", "books", canonical: ["year": 20])).isEmpty, "a year that is not a year is not a year")
        XCTAssertEqual(keys(logicItem("y3", "books", canonical: ["year": 1962])), "year:1962|decade:1960s", "the decade is the year's own")
        XCTAssertTrue(Tags.for(logicItem("l", "recipes", canonical: ["author": "By the test kitchen team, who made this eleven times before it worked properly"])).isEmpty,
                      "a sentence that landed in an author field is not a tag")
        XCTAssertEqual(keys(logicItem("o", "books", canonical: ["author": ["name": "Someone"], "genres": [["name": "Horror"], 7, true] as [Any]])), "genre:7",
                       "objects and booleans are not values; a number is")
    }

    func testDeDuplication() {
        XCTAssertEqual(keys(logicItem("dd", "restaurants", canonical: ["cuisine": ["Indian", "indian", "INDIAN "]])), "cuisine:indian", "three spellings of one cuisine are one tag")
        XCTAssertEqual(keys(logicItem("ac", "places", canonical: ["area": "London", "city": "London"])), "city:london", "area and city the same word → said once, as the city")
        XCTAssertEqual(keys(logicItem("gs", "books", canonical: ["genres": ["Fantasy"], "subjects": ["fantasy", "Gothic"]])), "genre:fantasy|genre:gothic",
                       "genres and subjects are one kind and do not repeat each other")
    }

    func testOnlyAFiledItemHasTags() {
        for status in [ItemStatus.pending, .unread] {
            XCTAssertTrue(Tags.for(logicItem("p", "books", "Piranesi", canonical: ["author": "Susanna Clarke"], status: status)).isEmpty,
                          "a \(status) row gives no tags, whatever is sitting in its fields")
        }
    }

    func testTheIndexIsMostUsedFirstThenByName() {
        let shelf = [
            logicItem("p", "books", "Piranesi", canonical: ["author": "Susanna Clarke"]),
            logicItem("j", "books", "Jonathan Strange", canonical: ["author": "susanna clarke"]),
            logicItem("z", "books", canonical: ["author": "Susanna Clarke"], status: .pending),
            logicItem("q", "quotes", "Attention", subtitle: "Mary Oliver"),
            logicItem("u", "books", "Upstream", canonical: ["author": "Mary Oliver"]),
        ]
        let idx = Tags.index(shelf)
        let clarke = idx.first { $0.key == "author:susanna clarke" }
        XCTAssertEqual(clarke?.ids, ["p", "j"], "two spellings of one author are ONE row — and the pending row is not counted")
        XCTAssertEqual(clarke?.value, "Susanna Clarke", "the spelling shown is the first one met")
        XCTAssertEqual(idx.first { $0.key == "author:mary oliver" }?.ids, ["q", "u"], "a quote and a book by the same person share a tag")
        // Three single-use tags given in the WRONG order, so an unsorted index
        // cannot pass by luck.
        let byName = Tags.index([
            logicItem("1", "places", canonical: ["city": "Zagreb"]), logicItem("2", "places", canonical: ["city": "Athens"]),
            logicItem("3", "places", canonical: ["city": "Lisbon"]), logicItem("4", "places", canonical: ["city": "Lisbon"]),
        ]).map(\.value)
        XCTAssertEqual(byName, ["Lisbon", "Athens", "Zagreb"], "count first, then the name — not the order they arrived in")
        // (No "no shelf, no crash" case: in Swift a shelf is always an array.)
    }

    func testTheKindIsPartOfTheTag() {
        let shelf = [logicItem("s", "movies", "Sinners", canonical: ["director": "Ryan Coogler"]), logicItem("p", "books", "x", canonical: ["author": "Susanna Clarke"]),
                     logicItem("z", "books", canonical: ["author": "Susanna Clarke"], status: .pending)]
        XCTAssertTrue(Tags.items(shelf, withTag: "author:ryan coogler").isEmpty, "a director is not an author with the same name")
        XCTAssertEqual(Tags.items(shelf, withTag: "director:ryan coogler").map(\.id), ["s"])
        XCTAssertEqual(Tags.items(shelf, withTag: "author:susanna clarke").map(\.id), ["p"], "pending left out")
    }

    // ── the JS corners every port leans on ───────────────────────────────────
    func testNumbersPrintAsJavaScriptPrintsThem() {
        for (n, s) in [(2020.0, "2020"), (4.3, "4.3"), (-0.1027, "-0.1027"), (1e21, "1e+21"), (1e-7, "1e-7"), (0.000001, "0.000001"),
                       (123456789012345680000.0, "123456789012345680000"), (0.0, "0"), (-0.5, "-0.5"), (1.5e-7, "1.5e-7"), (1e15, "1000000000000000"), (12345.678, "12345.678")] {
            XCTAssertEqual(JSLogic.number(n), s)
        }
    }

    func testDatesParseAsJavaScriptParsesThem() {
        XCTAssertEqual(JSLogic.dateParse("2026-08-01T00:00:00.000Z"), 1_785_542_400_000)
        XCTAssertEqual(JSLogic.dateParse("2026-08-01T00:00:00Z"), 1_785_542_400_000)
        XCTAssertEqual(JSLogic.dateParse("2026-08-01"), 1_785_542_400_000, "a date alone is midnight UTC")
        XCTAssertEqual(JSLogic.dateParse("2026-08-01T00:00:00+01:00"), 1_785_538_800_000)
        XCTAssertEqual(JSLogic.dateParse("2026-08-01T00:00:00.1234Z"), 1_785_542_400_123)
        XCTAssertEqual(JSLogic.dateParse("2026-02-30"), 1_772_409_600_000, "V8 rolls a day past the month's end into the next")
        XCTAssertNil(JSLogic.dateParse(""))
        XCTAssertNil(JSLogic.dateParse("not a date"))
        XCTAssertNil(JSLogic.dateParse("2026-08-01T00:00:00+01"))
        XCTAssertNil(JSLogic.dateParse("2026-08-01T00:00:00Z and more"), "a date with something after it is not a date")
    }
}
