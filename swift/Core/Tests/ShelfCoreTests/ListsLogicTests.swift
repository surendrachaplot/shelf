// ListsLogicTests.swift — ListsLogic.swift against the real lists.js
// (golden-lists.json), plus the rules of app/lists-selftest.mjs: a pin stays
// where it was put, an operation with nothing to do changes nothing, a saved
// search finds what Find finds, and pounds are never added to yen.
import XCTest
@testable import ShelfCore

final class ListsLogicTests: XCTestCase {
    private let gb = Locale(identifier: "en-GB")
    private func locale(_ v: JSONValue?) -> Locale { Locale(identifier: v?.string ?? "en-GB") }
    private func json(_ boards: [Board]) throws -> JSONValue {
        .array(boards.map { .object(["id": .string($0.id), "name": .string($0.name), "pins": LogicGolden.strings($0.pins), "query": LogicGolden.string($0.query),
                                     "view": .string($0.view.rawValue), "created_at": .string($0.createdAt)]) })
    }
    private func json(_ t: ListsLogic.Total) -> JSONValue {
        .object([
            "byCurrency": .array(t.byCurrency.map { .object(["currency": .string($0.currency), "amount": .number($0.amount), "text": .string($0.text)]) }),
            "priced": .number(Double(t.priced)), "unpriced": .number(Double(t.unpriced)),
        ])
    }

    // ── golden parity ────────────────────────────────────────────────────────
    func testGoldenMakeList() throws {
        let g = try LogicGolden.load("golden-lists")
        XCTAssertEqual(Double(ListsLogic.nameMax), g["nameMax"]?.number)
        XCTAssertEqual(ListsLogic.views.map(\.rawValue), (g["views"]?.array ?? []).compactMap(\.string))
        for c in LogicGolden.cases(g, "makeList") {
            let now = Date(timeIntervalSince1970: (JSLogic.dateParse(c.input["now"]?.string ?? "") ?? 0) / 1000)
            let made = ListsLogic.make(name: c.input["name"]?.string, id: c.input["id"]?.string, now: now)
            LogicGolden.same(try made.map { try json([$0]).array![0] } ?? .null, c.output, "makeList \(c.input)")
        }
    }

    func testGoldenOperations() throws {
        let g = try LogicGolden.load("golden-lists")
        let boards = try LogicGolden.boards(g["boards"])
        let items = try LogicGolden.items(g["items"])
        var changed = 0
        for c in LogicGolden.cases(g, "ops") {
            let i = c.input
            let id = i["id"]?.string ?? "", itemId = i["itemId"]?.string ?? ""
            let got: [Board]
            switch i["op"]?.string {
            case "rename": got = ListsLogic.rename(boards, id: id, name: i["name"]?.string)
            case "remove": got = ListsLogic.remove(boards, id: id)
            case "setView":
                // A view that does not exist cannot be said in Swift. The JS
                // refuses it; check that, and move on.
                guard let view = Board.View(rawValue: i["view"]?.string ?? "") else {
                    LogicGolden.same(try json(boards), c.output, "a view that does not exist changes nothing")
                    continue
                }
                got = ListsLogic.setView(boards, id: id, view: view)
            case "setQuery": got = ListsLogic.setQuery(boards, id: id, query: i["query"]?.string)
            case "pin": got = ListsLogic.pin(boards, id: id, itemId: itemId)
            case "unpin": got = ListsLogic.unpin(boards, id: id, itemId: itemId)
            case "togglePin": got = ListsLogic.togglePin(boards, id: id, itemId: itemId)
            case "movePin": got = ListsLogic.movePin(boards, id: id, itemId: itemId, toIndex: Int(i["toIndex"]?.number ?? 0))
            case "prune":
                let keep = i["keep"]?.strings
                got = ListsLogic.prune(boards, items: keep.map { k in items.filter { k.contains($0.id) } } ?? items)
            default:
                XCTFail("an operation this test does not know: \(i)")
                continue
            }
            if got != boards { changed += 1 }
            LogicGolden.same(try json(got), c.output, "\(i)")
        }
        XCTAssertGreaterThan(changed, 20, "many of the operations really change something")
    }

    func testGoldenItemsOfAndListsWith() throws {
        let g = try LogicGolden.load("golden-lists")
        let boards = try LogicGolden.boards(g["boards"])
        let items = try LogicGolden.items(g["items"])
        for c in LogicGolden.cases(g, "itemsOf") {
            let b = try XCTUnwrap(boards.first { $0.id == c.input["id"]?.string })
            LogicGolden.same(LogicGolden.strings(ListsLogic.items(of: b, in: items).map(\.id)), c.output, "itemsOf \(b.id)")
        }
        for c in LogicGolden.cases(g, "listsWith") {
            LogicGolden.same(LogicGolden.strings(ListsLogic.lists(boards, with: c.input["itemId"]?.string ?? "").map(\.id)), c.output, "listsWith \(c.input)")
        }
    }

    func testGoldenPrices() throws {
        let g = try LogicGolden.load("golden-lists")
        var runs: [String: [Item]] = [:]
        for (name, v) in g["runs"]?.object ?? [:] { runs[name] = try LogicGolden.items(v) }
        let items = try LogicGolden.items(g["items"])
        for c in LogicGolden.cases(g, "priceOf") {
            let it = try XCTUnwrap(runs[c.input["run"]?.string ?? ""]?.first { $0.id == c.input["id"]?.string })
            let p = ListsLogic.price(of: it)
            LogicGolden.same(p.map { .object(["amount": .number($0.amount), "currency": .string($0.currency)]) } ?? .null, c.output, "priceOf \(c.input)")
        }
        for c in LogicGolden.cases(g, "priceOn") {
            let it = try XCTUnwrap(items.first { $0.id == c.input["id"]?.string })
            LogicGolden.same(LogicGolden.string(ListsLogic.priceOn(it, locale: locale(c.input["locale"]))), c.output, "priceOn \(c.input)")
        }
        let texts = LogicGolden.cases(g, "priceText")
        XCTAssertGreaterThan(texts.count, 400)
        var drifted = 0
        for c in texts {
            let got = ListsLogic.priceText(c.input["amount"]?.number ?? 0, c.input["currency"]?.string ?? "", locale: locale(c.input["locale"]))
            // ONE SIGN IS NEWER ON THE MAC THAN IN NODE. The Saudi riyal got its
            // own sign (U+20C1) in CLDR 48; Node 24 carries CLDR 47 and still
            // writes "SAR". The phone's sign is the right one to show, so the
            // digits and the grouping are compared and either sign is accepted.
            if c.input["currency"]?.string == "SAR", got.hasPrefix("\u{20C1}") {
                drifted += 1
                LogicGolden.same(.string(got.replacingOccurrences(of: "\u{20C1}", with: "SAR\u{A0}")), c.output, "priceText \(c.input)")
                continue
            }
            LogicGolden.same(.string(got), c.output, "priceText \(c.input)")
        }
        XCTAssertLessThanOrEqual(drifted, 2, "only the two riyal cases may differ by their sign")
    }

    func testGoldenTotals() throws {
        let g = try LogicGolden.load("golden-lists")
        var runs: [String: [Item]] = [:]
        for (name, v) in g["runs"]?.object ?? [:] { runs[name] = try LogicGolden.items(v) }
        let boards = try LogicGolden.boards(g["boards"])
        let items = try LogicGolden.items(g["items"])
        var lines = 0
        for c in LogicGolden.cases(g, "shelfTotal") {
            let run = try XCTUnwrap(runs[c.input["run"]?.string ?? ""])
            let t = ListsLogic.shelfTotal(run, locale: locale(c.input["locale"]))
            lines += t.byCurrency.count
            LogicGolden.same(json(t), c.output, "shelfTotal \(c.input)")
        }
        for c in LogicGolden.cases(g, "totalOf") {
            let b = try XCTUnwrap(boards.first { $0.id == c.input["id"]?.string })
            LogicGolden.same(json(ListsLogic.total(of: b, in: items, locale: locale(c.input["locale"]))), c.output, "totalOf \(c.input)")
        }
        XCTAssertGreaterThan(lines, 40, "the runs really have totals to compare")
    }

    // ── the rules, from lists-selftest.mjs ───────────────────────────────────
    private func list(_ id: String, name: String? = nil, pins: [String] = [], query: String? = nil, view: Board.View = .pictures) -> Board {
        Board(id: id, name: name ?? id, pins: pins, query: query, view: view, createdAt: "2026-01-01T00:00:00.000Z")
    }
    private func product(_ id: String, _ title: String, _ price: Double, _ currency: String, _ text: String) -> Item {
        logicItem(id, "wishlist", title, canonical: ["kind": "product", "price": price, "currency": currency, "price_text": text, "brand": "Maker", "availability": "in_stock"])
    }
    private func priced(_ price: Any?, _ currency: Any?, _ id: String = "x") -> Item { logicItem(id, "wishlist", id, canonical: ["price": price, "currency": currency]) }

    private var shelf: [Item] {
        [logicItem("p", "books", "Piranesi", subtitle: "Susanna Clarke", canonical: ["author": "Susanna Clarke", "year": 2020, "subjects": ["Fantasy"], "price": 9.99, "currency": "GBP"]),
         logicItem("s", "movies", "Sinners", subtitle: "Ryan Coogler · 2025", canonical: ["year": "2025", "director": "Ryan Coogler", "genres": ["Horror"]]),
         logicItem("g", "restaurants", "Ganapati", subtitle: "South indian · Peckham", canonical: ["area": "Peckham", "cuisine": ["South indian"], "lat": 51.47, "lng": -0.07]),
         logicItem("b", "places", "Belém", subtitle: "Belém · Lisbon", canonical: ["city": "Lisbon", "area": "Belém", "located": true], created: "2026-02-01T00:00:00.000Z"),
         logicItem("m", "places", "Time Out Market", subtitle: "Cais do Sodré · Lisbon", canonical: ["city": "Lisbon", "area": "Cais do Sodré", "located": true], created: "2026-03-01T00:00:00.000Z"),
         logicItem("d", "recipes", "Lemon dal", subtitle: "45 min · 4 servings", canonical: ["author": "Meera Sodha", "cuisine": "Indian", "total_time": "45 min"]),
         logicItem("q", "quotes", "Attention is the beginning of devotion.", subtitle: "Mary Oliver"),
         // A saved article: the city is only in its text.
         logicItem("e", "unsorted", "A week by the Tagus", subtitle: "Field Notes",
                   canonical: ["article": ["byline": "R. Okafor", "siteName": "Field Notes", "text": "We landed in Lisbon on a Tuesday and did not leave the hill for three days.", "summary": "A slow week."]]),
         logicItem("z", "unsorted", status: .pending),
         product("w1", "Anglepoise lamp", 120, "GBP", "£120.00"), product("w2", "Bentwood chair", 349.5, "EUR", "€349.50"), product("w3", "Petty knife", 12000, "JPY", "¥12,000"),
         logicItem("n", "notes", "Brown boots, not black.", note: "Brown boots, not black. Ask Maya about the scarf.", canonical: ["kind": "note"])]
    }
    private var L: [Board] { [list("a", name: "Weekend", pins: ["g", "p", "s"]), list("b", name: "Lisbon", query: "lisbon", view: .rows)] }
    private func ids(_ xs: [Item]) -> String { xs.map(\.id).joined(separator: ",") }

    func testMakingOne() throws {
        let now = Date(timeIntervalSince1970: 1_767_225_600)
        let l = try XCTUnwrap(ListsLogic.make(name: "  Lisbon   trip ", id: "l1", now: now))
        XCTAssertEqual(l.name, "Lisbon trip", "the name is trimmed, and a run of spaces is one space")
        XCTAssertEqual(l.id, "l1", "an id that is handed in is the id")
        XCTAssertEqual(l.createdAt, "2026-01-01T00:00:00.000Z", "created_at is the `now` it was given")
        XCTAssertTrue(l.pins.isEmpty && l.query == nil, "a new list has no pins and no saved search")
        XCTAssertEqual(l.view, .pictures, "and opens as pictures")
        for bad in ["", "   \n ", nil] { XCTAssertNil(ListsLogic.make(name: bad), "no name → no list") }
        XCTAssertEqual(ListsLogic.make(name: String(repeating: "x", count: 80))?.name.count, 60, "a name is capped at 60")
        XCTAssertEqual(ListsLogic.make(name: "   " + String(repeating: "x", count: 60))?.name.count, 60, "spaces in front are not counted toward the 60")
        // The 60th character is an emoji, which is TWO UTF-16 units.
        let name = try XCTUnwrap(ListsLogic.make(name: String(repeating: "a", count: 59) + "😀b")?.name)
        XCTAssertTrue(name.hasSuffix("😀") && name.unicodeScalars.count == 60, "the cap counts characters — it never leaves half an emoji")
        XCTAssertEqual(ListsLogic.make(name: String(repeating: "a", count: 59) + " bbb")?.name, String(repeating: "a", count: 59), "a cut that lands on a space does not keep the space")
        let a = try XCTUnwrap(ListsLogic.make(name: "One")), b = try XCTUnwrap(ListsLogic.make(name: "Two"))
        XCTAssertNotNil(a.id.range(of: "^l_[a-z0-9]{6,}$", options: .regularExpression), "no id handed in → it makes one")
        XCTAssertNotEqual(a.id, b.id, "and not the same one twice")
        XCTAssertLessThan(abs((JSLogic.dateParse(a.createdAt) ?? 0) / 1000 - Date().timeIntervalSince1970), 60, "no `now` handed in → the clock")
    }

    func testAnOperationWithNothingToDoChangesNothing() {
        // Rule 1: the caller compares with == and skips the save.
        let L = self.L
        XCTAssertEqual(ListsLogic.rename(L, id: "a", name: "   "), L, "rename to nothing: the list keeps the name it had")
        XCTAssertEqual(ListsLogic.rename(L, id: "nope", name: "Porto"), L)
        XCTAssertEqual(ListsLogic.rename(L, id: "a", name: "Weekend"), L)
        XCTAssertEqual(ListsLogic.remove(L, id: "nope"), L)
        XCTAssertEqual(ListsLogic.setView(L, id: "a", view: .pictures), L)
        XCTAssertEqual(ListsLogic.setView(L, id: "nope", view: .rows), L)
        XCTAssertEqual(ListsLogic.setQuery(L, id: "b", query: "lisbon"), L)
        XCTAssertEqual(ListsLogic.setQuery(L, id: "a", query: ""), L, "clearing a query that is not set")
        XCTAssertEqual(ListsLogic.pin(L, id: "a", itemId: "p"), L, "pinning what is already pinned")
        XCTAssertEqual(ListsLogic.pin(L, id: "nope", itemId: "p"), L)
        XCTAssertEqual(ListsLogic.pin(L, id: "a", itemId: ""), L, "pinning an empty id")
        XCTAssertEqual(ListsLogic.unpin(L, id: "a", itemId: "d"), L, "unpinning what is not pinned")
        XCTAssertEqual(ListsLogic.togglePin(L, id: "nope", itemId: "p"), L)
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "p", toIndex: 1), L, "moving a pin to where it is")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "g", toIndex: -5), L, "moving the first pin before the start")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "s", toIndex: 99), L, "moving the last pin past the end")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "d", toIndex: 0), L, "moving what is not pinned")
        XCTAssertEqual(ListsLogic.prune(L, items: shelf), L, "nothing dead anywhere")
    }

    func testRenameRemoveViewAndQuery() {
        let L = self.L
        let renamed = ListsLogic.rename(L, id: "a", name: "  Porto ")
        XCTAssertEqual(renamed[0].name, "Porto", "the new name, trimmed")
        XCTAssertEqual(renamed[1], L[1], "the other list is untouched")
        XCTAssertEqual(renamed[0].pins, L[0].pins, "the pins come with it")
        XCTAssertEqual(ListsLogic.rename(L, id: "a", name: String(repeating: "y", count: 90))[0].name.count, 60, "capped like a new name")
        XCTAssertEqual(ListsLogic.remove(L, id: "a").map(\.id), ["b"], "the list is gone and the other is not")
        XCTAssertEqual(ListsLogic.setView(L, id: "a", view: .rows)[0].view, .rows)
        XCTAssertEqual(ListsLogic.setQuery(L, id: "a", query: "  peckham ")[0].query, "peckham", "saved, trimmed")
        for blank in ["", "   ", nil] { XCTAssertNil(ListsLogic.setQuery(L, id: "b", query: blank)[1].query, "a blank is NO saved search — nil, not \"\"") }
    }

    func testPinsKeepTheOrderThePersonGaveThem() {
        let L = self.L
        XCTAssertEqual(ListsLogic.pin(L, id: "a", itemId: "d")[0].pins, ["g", "p", "s", "d"], "a new pin goes on the END — what was arranged stays arranged")
        XCTAssertEqual(ListsLogic.pin(L, id: "a", itemId: "d")[1], L[1])
        XCTAssertEqual(ListsLogic.unpin(L, id: "a", itemId: "p")[0].pins, ["g", "s"], "gone, and the rest keep their order")
        XCTAssertEqual(ListsLogic.togglePin(L, id: "a", itemId: "p")[0].pins, ["g", "s"], "toggle: on → off")
        XCTAssertEqual(ListsLogic.togglePin(L, id: "a", itemId: "d")[0].pins, ["g", "p", "s", "d"], "toggle: off → on, at the end")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "s", toIndex: 0)[0].pins, ["s", "g", "p"], "the last pin to the front")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "g", toIndex: 2)[0].pins, ["p", "s", "g"], "the first pin to the back")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "g", toIndex: 1)[0].pins, ["p", "g", "s"], "toIndex is where it ENDS UP")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "g", toIndex: 99)[0].pins, ["p", "s", "g"], "past the end is the end")
        XCTAssertEqual(ListsLogic.movePin(L, id: "a", itemId: "s", toIndex: -5)[0].pins, ["s", "g", "p"], "before the start is the start")
    }

    func testWhatIsOnAList() {
        let shelf = self.shelf
        XCTAssertEqual(ids(ListsLogic.items(of: L[0], in: shelf)), "g,p,s", "pins come back in PIN order, not the shelf's (which is p,s,g)")
        XCTAssertEqual(ids(ListsLogic.items(of: list("x", pins: ["g", "gone", "p"]), in: shelf)), "g,p", "a pin whose item is gone is skipped — no hole, no crash")
        XCTAssertEqual(ids(ListsLogic.items(of: list("x", pins: ["p", "g", "p"]), in: shelf)), "p,g", "the same id pinned twice is one thing on the list")
        XCTAssertEqual(ids(ListsLogic.items(of: list("x", pins: ["z"]), in: shelf)), "z", "a link nobody has read yet can sit on a list")
        let found = ids(ListsLogic.items(of: L[1], in: shelf))
        XCTAssertEqual(found, "m,b,e", "a saved search finds the two places AND the article that only mentions the city")
        XCTAssertEqual(found, ids(Find.search(items: shelf, query: "lisbon").hits.map(\.item)), "in exactly Find's order — one definition of found")
        XCTAssertEqual(ids(ListsLogic.items(of: list("x", pins: ["b", "p"], query: "lisbon"), in: shelf)), "b,p,m,e", "pins first, then the search — and a pinned match is not there twice")
        XCTAssertEqual(ids(ListsLogic.items(of: list("x", pins: ["p"], query: "   "), in: shelf)), "p", "a blank saved search finds nothing, not everything")
        XCTAssertTrue(ListsLogic.items(of: list("x", query: "zzzzqq"), in: shelf).isEmpty)
        XCTAssertTrue(ListsLogic.items(of: nil, in: shelf).isEmpty, "no list → nothing")
        // Find shows the best 60. A list is not a box you are still typing in.
        let many = (0..<70).map { logicItem("c\($0)", "places", "Place \($0)", canonical: ["city": "Lisbon"]) }
        XCTAssertEqual(ListsLogic.items(of: list("x", query: "lisbon"), in: many).count, 70, "a saved search is NOT cut at Find's sixty")
    }

    func testPruneIsTheOnlyThingThatForgetsAPin() {
        let dirty = [list("a", pins: ["g", "gone", "p", "also-gone"]), list("b", pins: ["s"])]
        let out = ListsLogic.prune(dirty, items: shelf)
        XCTAssertEqual(out[0].pins, ["g", "p"], "dead pins go, the live ones keep their order")
        XCTAssertEqual(out[1], dirty[1], "a list with nothing dead on it is untouched")
        XCTAssertEqual(ListsLogic.items(of: dirty[0], in: shelf).map(\.id), ["g", "p"], "and nothing needed prune to run: a dead pin is skipped anyway")
    }

    func testWhichListsIsThisOn() {
        let three = [list("a", pins: ["p", "s"]), list("b", query: "piranesi"), list("c", pins: ["g", "p"])]
        XCTAssertEqual(ListsLogic.lists(three, with: "p").map(\.id), ["a", "c"], "the lists a thing is pinned on, in the lists' own order")
        // B's saved search finds Piranesi. Nobody PUT it on B.
        XCTAssertEqual(ListsLogic.items(of: three[1], in: shelf).map(\.id), ["p"])
        XCTAssertFalse(ListsLogic.lists(three, with: "p").contains { $0.id == "b" }, "a saved search finding it is not a pin")
        XCTAssertTrue(ListsLogic.lists(three, with: "nope").isEmpty)
    }

    func testAPriceIsAnAmountAndACurrency() {
        XCTAssertEqual(ListsLogic.price(of: shelf[0]), ListsLogic.Price(amount: 9.99, currency: "GBP"))
        XCTAssertEqual(ListsLogic.price(of: priced(5, " gbp "))?.currency, "GBP", "the code is upper case whatever the server sent")
        XCTAssertEqual(ListsLogic.price(of: priced(0, "GBP"))?.amount, 0, "ZERO is a price: free is a thing a wishlist can say")
        for bad: Any? in [nil, -1, "12.50"] { XCTAssertNil(ListsLogic.price(of: priced(bad, "GBP")), "a price that is \(bad ?? "null") is unpriced") }
        for bad: Any? in [nil, "£", "POUNDS", 826] {
            XCTAssertNil(ListsLogic.price(of: priced(12, bad)), "a price whose currency is \(bad ?? "missing") is unpriced — 12 of nothing is not a price")
        }
    }

    func testPriceText() {
        XCTAssertEqual(ListsLogic.priceText(12.5, "GBP", locale: gb), "£12.50", "pence are shown when there are pence")
        XCTAssertEqual(ListsLogic.priceText(12, "GBP", locale: gb), "£12", "and NOT when the amount is whole — £12, not £12.00")
        XCTAssertEqual(ListsLogic.priceText(1234.5, "GBP", locale: gb), "£1,234.50", "thousands are grouped")
        XCTAssertEqual(ListsLogic.priceText(12000, "JPY", locale: gb), "JP¥12,000", "a currency is named the way the reader's locale names it")
        XCTAssertTrue(ListsLogic.priceText(1.5, "KWD", locale: gb).hasSuffix("1.500"), "a currency with three decimal places gets three")
        XCTAssertEqual(ListsLogic.priceText(12.5, "USD", locale: Locale(identifier: "en-US")), "$12.50", "the locale handed in is the one used")
        XCTAssertEqual(ListsLogic.priceText(12.5, "USD", locale: gb), "US$12.50")
        XCTAssertEqual(ListsLogic.priceText(12.5, "POUNDS", locale: gb), "POUNDS 12.50", "a code that cannot be formatted: the code and the number")
        XCTAssertEqual(ListsLogic.priceText(12, "£", locale: gb), "£ 12", "and still no .00 on a whole amount")
    }

    func testNeverAddTwoCurrenciesTogether() {
        let shelf = self.shelf
        let t = ListsLogic.shelfTotal([shelf[0], shelf[9], shelf[10], shelf[11], shelf[1]], locale: gb)
        XCTAssertEqual(t.byCurrency.count, 3, "three currencies are three lines")
        XCTAssertEqual(t.byCurrency.map(\.currency), ["JPY", "EUR", "GBP"], "largest amount first")
        XCTAssertEqual(t.byCurrency.map(\.amount), [12000, 349.5, 129.99], "each line is that currency's own sum — NEVER one number for two currencies")
        XCTAssertEqual(t.byCurrency.map(\.text), ["JP¥12,000", "€349.50", "£129.99"], "each line has its text")
        XCTAssertEqual(t.priced, 4, "priced counts what went into a line")
        XCTAssertEqual(t.unpriced, 1, "unpriced counts what did not — the film")
        // Given dollars first, so an unsorted answer cannot pass by luck.
        let tie = ListsLogic.shelfTotal([priced(10, "USD", "u"), priced(10, "EUR", "e")], locale: gb)
        XCTAssertEqual(tie.byCurrency.map(\.currency), ["EUR", "USD"], "the same amount in two currencies: by code, so the lines do not swap")
        let mixed = ListsLogic.shelfTotal([priced(5, "gbp", "a"), priced(7, "GBP", "b")], locale: gb)
        XCTAssertEqual(mixed.byCurrency.map(\.amount), [12], "gbp and GBP are one currency and one line")
    }

    func testATotalIsSummedInTheSmallestUnit() {
        let t = ListsLogic.shelfTotal([priced(0.1, "GBP", "k"), priced(0.2, "GBP", "c")], locale: gb)
        XCTAssertEqual(t.byCurrency.first?.amount, 0.3, "0.1 + 0.2 is 0.3 — summed in pence, not in floats")
        XCTAssertEqual(t.byCurrency.first?.text, "£0.30")
        XCTAssertEqual(ListsLogic.shelfTotal([priced(120, "GBP", "a"), priced(80, "GBP", "b")], locale: gb).byCurrency.first?.text, "£200", "a whole total has no .00")
        // A dinar has a thousand fils. Rounded to pence, both of these are nothing.
        XCTAssertEqual(ListsLogic.shelfTotal([priced(0.001, "KWD", "a"), priced(0.002, "KWD", "b")], locale: gb).byCurrency.first?.amount, 0.003,
                       "the smallest unit is the CURRENCY's, not always a hundredth")
        let free = ListsLogic.shelfTotal([priced(0, "GBP", "a")], locale: gb)
        XCTAssertEqual(free.priced, 1)
        XCTAssertEqual(free.byCurrency.first?.text, "£0", "something free is priced, and its line says £0")
        let whole = ListsLogic.shelfTotal(shelf, locale: gb)
        XCTAssertEqual(whole.priced, 4)
        XCTAssertEqual(whole.unpriced, shelf.count - 4, "everything is either priced or unpriced")
        XCTAssertEqual(ListsLogic.shelfTotal([], locale: gb), ListsLogic.Total(), "the total of no shelf is no lines and two zeros")
    }

    func testAListsTotalIsItsOwnThings() {
        let shelf = self.shelf
        let t = ListsLogic.total(of: list("x", pins: ["p", "gone", "w1", "s"]), in: shelf, locale: gb)
        XCTAssertEqual(t.byCurrency.map(\.text), ["£129.99"], "a list's total is its OWN things, not the shelf's")
        XCTAssertEqual([t.priced, t.unpriced], [2, 1], "a pin whose item is gone is not counted as anything")
        let found = ListsLogic.total(of: list("x", pins: ["w2"], query: "piranesi"), in: shelf, locale: gb)
        XCTAssertEqual(found.byCurrency.map(\.text), ["€349.50", "£9.99"], "what the saved search finds is in the total too")
        // A locale that writes the decimal point as a comma.
        let de = ListsLogic.total(of: list("x", pins: ["w2"]), in: shelf, locale: Locale(identifier: "de-DE"))
        XCTAssertTrue(de.byCurrency.first?.text.hasPrefix("349,50") ?? false, "the locale handed to a list's total reaches the text")
        let lisbon = ListsLogic.total(of: L[1], in: shelf, locale: gb)
        XCTAssertEqual([lisbon.byCurrency.count, lisbon.priced, lisbon.unpriced], [0, 0, 3], "a list of places: no total line, three unpriced")
        XCTAssertEqual(ListsLogic.total(of: nil, in: shelf, locale: gb), ListsLogic.Total(), "no list → nothing to total")
    }

    func testOneFormatterForAJacketARowAndTheTotal() {
        // The server's text says "£120.00" and the total says "£120"; side by
        // side that reads as two apps.
        let shelf = self.shelf
        XCTAssertEqual(ListsLogic.priceOn(shelf[9], locale: gb), "£120")
        XCTAssertEqual(ListsLogic.priceOn(shelf[9], locale: gb), ListsLogic.shelfTotal([shelf[9]], locale: gb).byCurrency.first?.text,
                       "what one thing costs is written the way a total of one thing is")
        XCTAssertEqual(ListsLogic.priceOn(shelf[10], locale: gb), "€349.50", "pence are kept when there are pence")
        XCTAssertEqual(ListsLogic.priceOn(logicItem("r", "wishlist", canonical: ["kind": "product", "price": 20, "currency": "USD", "price_text": "$20 to $35"]), locale: gb), "$20 to $35",
                       "a range is something a single number cannot say, so the shop's own words are kept")
        XCTAssertEqual(ListsLogic.priceOn(logicItem("t", "wishlist", canonical: ["kind": "product", "price": nil, "currency": nil, "price_text": "From £9"]), locale: gb), "From £9",
                       "with no number to format, the shop's text is still better than nothing")
        XCTAssertNil(ListsLogic.priceOn(shelf[12]), "no price is nil — never \"\"")
        XCTAssertNil(ListsLogic.priceOn(logicItem("x", "books", "x", canonical: ["price_text": 7])))
        XCTAssertNil(ListsLogic.priceOn(logicItem("x", "books", "x", canonical: ["price_text": ""])))
    }
}
