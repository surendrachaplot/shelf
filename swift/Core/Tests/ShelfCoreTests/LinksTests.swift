// LinksTests.swift — Links.swift against the real links.js (golden-links.json),
// plus the rules of app/links-selftest.mjs. A wrong link does not look wrong:
// "Also by Susanna Clarke" over a book she did not write is a tidy, confident row.
import XCTest
@testable import ShelfCore

final class LinksTests: XCTestCase {
    private func show(_ groups: [Links.Group]) -> String {
        groups.map { "\($0.reason.kind):\($0.reason.value)=\($0.items.map(\.id).joined(separator: "+"))" }.joined(separator: "|")
    }

    private let shelf: [Item] = [
        logicItem("p", "books", "Piranesi", canonical: ["author": "Susanna Clarke", "year": 2020, "subjects": ["Fantasy"]]),
        logicItem("j", "books", "Jonathan Strange & Mr Norrell", canonical: ["author": "susanna clarke", "year": 2004, "subjects": ["Fantasy"]]),
        logicItem("k", "books", "Klara and the Sun", canonical: ["author": "Kazuo Ishiguro", "year": 2020, "subjects": ["Fantasy"]]),
        logicItem("s", "movies", "Sinners", canonical: ["year": "2025", "director": "Ryan Coogler", "genres": ["Horror"], "cast": ["Michael B. Jordan", "Hailee Steinfeld"]]),
        logicItem("c", "movies", "Creed", canonical: ["year": "2015", "director": "Ryan Coogler", "genres": ["Drama"], "cast": ["Michael B. Jordan", "Sylvester Stallone"]]),
        logicItem("m", "movies", "Just Mercy", canonical: ["year": "2019", "director": "Destin Daniel Cretton", "genres": ["Drama"], "cast": ["Michael B. Jordan"]]),
        logicItem("g", "restaurants", "Ganapati", canonical: ["area": "Peckham", "cuisine": ["South indian"]]),
        logicItem("di", "restaurants", "Dishoom", canonical: ["area": "Shoreditch", "cuisine": ["South indian"]]),
        logicItem("ms", "places", "Multi Story", canonical: ["area": "Peckham", "city": "London", "located": true]),
        logicItem("bb", "places", "Book Bar", canonical: ["area": "Bounds Green", "city": "London", "located": true]),
        logicItem("be", "places", "Belém Tower", canonical: ["city": "Lisbon", "located": true]),
        logicItem("d", "recipes", "Lemon dal", canonical: ["author": "Meera Sodha", "cuisine": "Indian", "article": ["siteName": "The Guardian"]]),
        logicItem("cu", "recipes", "Aubergine curry", canonical: ["author": "Meera Sodha", "cuisine": "Indian", "article": ["siteName": "The Guardian"]]),
        logicItem("t", "recipes", "Cheese toast", canonical: ["author": "Felicity Cloake", "cuisine": "British", "article": ["siteName": "The Guardian"]]),
        logicItem("q", "quotes", "Attention is the beginning of devotion.", subtitle: "Mary Oliver"),
        logicItem("u", "books", "Upstream", canonical: ["author": "Mary Oliver", "year": 2016]),
    ]
    private func one(_ id: String) -> Item { shelf.first { $0.id == id }! }
    private func links(_ id: String) -> String { show(Links.for(one(id), in: shelf)) }

    // ── golden parity ────────────────────────────────────────────────────────
    func testGoldenLinksForEveryItem() throws {
        let g = try LogicGolden.load("golden-links")
        let items = try LogicGolden.items(g["items"])
        LogicGolden.same(LogicGolden.strings(Links.kinds), g["kinds"] ?? .null, "LINK_KINDS")
        let cases = LogicGolden.cases(g, "linksFor")
        XCTAssertEqual(cases.count, items.count)
        var groups = 0
        for c in cases {
            let it = try XCTUnwrap(items.first { $0.id == c.input["id"]?.string })
            let got = Links.for(it, in: items)
            groups += got.count
            let json = got.map { grp -> JSONValue in
                .object(["reason": .object(["kind": .string(grp.reason.kind), "value": .string(grp.reason.value)]), "ids": LogicGolden.strings(grp.items.map(\.id))])
            }
            LogicGolden.same(.array(json), c.output, "linksFor \(it.id)")
        }
        XCTAssertGreaterThan(groups, 20, "the fixture shelf really has links to compare")
    }

    // ── the rules, from links-selftest.mjs ───────────────────────────────────
    func testTheWholeListStrongestFirst() {
        XCTAssertEqual(Links.kinds, ["author", "director", "cast", "area", "city"], "adding to it is a decision")
    }

    func testSameAuthor() {
        XCTAssertEqual(links("p"), "author:Susanna Clarke=j", "same author, two spellings — and NOT the other 2020 fantasy novel")
        XCTAssertEqual(links("d"), "author:Meera Sodha=cu", "a recipe links by who wrote it — not by cuisine, and not by the website")
        XCTAssertEqual(links("q"), "author:Mary Oliver=u", "a quote finds the book by whoever said it, across shelves")
    }

    func testDirectorBeforeCastAndAPersonBeforeAPlace() {
        XCTAssertEqual(links("s"), "director:Ryan Coogler=c|cast:Michael B. Jordan=c+m", "director before cast; a cast member nobody shares makes no group")
        // Tags puts a place before the cast; a link's order is `kinds`, not the tags'.
        let both = logicItem("bt", "movies", "Shot on location", canonical: ["cast": ["Michael B. Jordan"], "city": "London"])
        XCTAssertEqual(show(Links.for(both, in: shelf)), "cast:Michael B. Jordan=s+c+m|city:London=ms+bb", "a person before a place, whatever order the tags were in")
    }

    func testNeighbourhoodBeforeCity() {
        XCTAssertEqual(links("ms"), "area:Peckham=g|city:London=bb", "a restaurant IS in a place's neighbourhood")
        XCTAssertEqual(links("g"), "area:Peckham=ms")
        XCTAssertTrue(Links.for(one("be"), in: shelf).isEmpty, "the only thing in Lisbon has no links — never an empty group")
    }

    func testTooWeakToBeALink() {
        XCTAssertTrue(Links.for(one("k"), in: shelf).isEmpty, "a shared YEAR and a shared GENRE are not a link")
        XCTAssertTrue(Links.for(one("di"), in: shelf).isEmpty, "a shared CUISINE is not a link")
        XCTAssertTrue(Links.for(one("t"), in: shelf).isEmpty, "a shared WEBSITE is not a link")
        let shirt = logicItem("w1", "wishlist", "Overshirt", canonical: ["kind": "product", "brand": "Northfield"])
        let scarf = logicItem("w2", "wishlist", "Scarf", canonical: ["kind": "product", "brand": "Northfield"])
        XCTAssertTrue(Links.for(shirt, in: [shirt, scarf]).isEmpty, "a shared brand is a tag, and is NOT a link")
    }

    func testAnItemIsNeverLinkedToItselfAndPendingRowsDoNotLink() {
        for it in shelf {
            for grp in Links.for(it, in: shelf) {
                XCTAssertFalse(grp.items.isEmpty, "no empty groups, anywhere")
                XCTAssertFalse(grp.items.contains { $0.id == it.id }, "an item is never linked to itself")
                XCTAssertTrue(Links.kinds.contains(grp.reason.kind))
            }
        }
        // The open item is very often a COPY of the row in the array, edited.
        var copy = one("p")
        copy.note = "edited since it was opened"
        XCTAssertEqual(show(Links.for(copy, in: shelf)), "author:Susanna Clarke=j", "a copy of an item is still that item")
        let pending = logicItem("z", "books", canonical: ["author": "Susanna Clarke"], status: .pending)
        XCTAssertEqual(show(Links.for(one("p"), in: shelf + [pending])), "author:Susanna Clarke=j", "a pending row is not offered as a link")
        XCTAssertTrue(Links.for(pending, in: shelf).isEmpty, "and has none of its own")
        XCTAssertTrue(Links.for(one("p"), in: []).isEmpty)
    }
}
