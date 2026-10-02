// FindTests.swift — Find.swift against the real find.js (golden-find.json),
// plus the ranking rules of app/find-selftest.mjs.
//
// ORDER IS INVISIBLE. "The right book is fourth" looks exactly like "the right
// book is first" in every other check, so the golden cases compare the hits in
// order, with their scores, and every ranking claim is written down as a
// fixture with an expected winner.
import XCTest
@testable import ShelfCore

final class FindTests: XCTestCase {
    private func sets(_ g: JSONValue) throws -> [String: [Item]] {
        var out: [String: [Item]] = [:]
        for (name, v) in g["sets"]?.object ?? [:] { out[name] = try LogicGolden.items(v) }
        XCTAssertFalse(out["main"]?.isEmpty ?? true)
        return out
    }
    private func strings(_ v: JSONValue?) -> [String] { (v?.array ?? []).map { $0.string ?? "" } }
    private func field(_ v: JSONValue?) throws -> Find.Field { try XCTUnwrap(Find.Field(rawValue: v?.string ?? "")) }
    private func results(_ r: Find.Results) -> JSONValue {
        .object([
            "hits": .array(r.hits.map { .object(["id": .string($0.item.id), "score": .number($0.score), "why": LogicGolden.string($0.why?.rawValue), "snippet": LogicGolden.string($0.snippet)]) }),
            "counts": .object(r.counts.mapValues { .number(Double($0)) }),
            "total": .number(Double(r.total)),
            "terms": LogicGolden.strings(r.terms),
        ])
    }
    private func ids(_ items: [Item], _ q: String, limit: Int = 60, list: String? = nil) -> [String] {
        Find.search(items: items, query: q, limit: limit, list: list).hits.map(\.item.id)
    }

    // ── golden parity ────────────────────────────────────────────────────────
    func testGoldenSearchRankingScoresAndSnippets() throws {
        let g = try LogicGolden.load("golden-find")
        let sets = try sets(g)
        let cases = LogicGolden.cases(g, "search")
        XCTAssertGreaterThanOrEqual(cases.count, 50)
        var hits = 0, explained = 0
        for c in cases {
            let items = try XCTUnwrap(sets[c.input["set"]?.string ?? ""])
            let limit = c.input["limit"]?.number ?? 60
            let r = Find.search(items: items, query: c.input["q"]?.string, limit: limit >= 1e9 ? .max : Int(limit), list: c.input["list"]?.string)
            hits += r.hits.count
            explained += r.hits.filter { $0.snippet != nil }.count
            LogicGolden.same(results(r), c.output, "search \(c.input)")
        }
        XCTAssertGreaterThan(hits, 300, "the queries really find things")
        XCTAssertGreaterThan(explained, 100, "and many rows carry a snippet to compare")
    }

    func testGoldenSnippets() throws {
        let g = try LogicGolden.load("golden-find")
        let sets = try sets(g)
        var cut = 0, halves = 0
        for c in LogicGolden.cases(g, "snippetOf") {
            let it = try XCTUnwrap(sets[c.input["set"]?.string ?? ""]?.first { $0.id == c.input["id"]?.string })
            let got = Find.snippet(of: it, field: try field(c.input["field"]), terms: strings(c.input["terms"]), width: Int(c.input["width"]?.number ?? 84))
            if got?.hasPrefix("…") == true { cut += 1 }
            if got?.contains("\u{FFFD}") == true { halves += 1 }
            LogicGolden.same(LogicGolden.string(got), c.output, "snippetOf \(c.input)")
        }
        XCTAssertGreaterThan(cut, 50, "many snippets open past the start, where the UTF-16 counting matters")
        XCTAssertGreaterThan(halves, 0, "and at least one is cut through the middle of an emoji")
    }

    func testGoldenFoldWordsEditsAndTokenScores() throws {
        let g = try LogicGolden.load("golden-find")
        for c in LogicGolden.cases(g, "fold") { LogicGolden.same(.string(Find.fold(c.input["s"]?.string)), c.output, "fold \(c.input)") }
        for c in LogicGolden.cases(g, "words") { LogicGolden.same(LogicGolden.strings(Find.words(c.input["s"]?.string)), c.output, "words \(c.input)") }
        for c in LogicGolden.cases(g, "withinOneEdit") {
            LogicGolden.same(.bool(Find.withinOneEdit(c.input["a"]?.string ?? "", c.input["b"]?.string ?? "")), c.output, "withinOneEdit \(c.input)")
        }
        for c in LogicGolden.cases(g, "tokenScore") {
            LogicGolden.same(.number(Find.tokenScore(c.input["a"]?.string ?? "", c.input["b"]?.string ?? "")), c.output, "tokenScore \(c.input)")
        }
        var weights: [String: JSONValue] = [:]
        for f in Find.Field.allCases { weights[f.rawValue] = .number(Find.weight(f)) }
        LogicGolden.same(.object(weights), g["weights"] ?? .null, "W")
    }

    func testGoldenFactsTextAndFields() throws {
        let g = try LogicGolden.load("golden-find")
        let main = try XCTUnwrap(try sets(g)["main"])
        for c in LogicGolden.cases(g, "factsText") {
            LogicGolden.same(.string(Find.factsText(c.input["canonical"]?.object ?? [:])), c.output, "factsText \(c.input)")
        }
        for c in LogicGolden.cases(g, "fieldsOf") {
            let it = try XCTUnwrap(main.first { $0.id == c.input["id"]?.string })
            let got = Find.fields(of: it).map { JSONValue.object(["name": .string($0.name.rawValue), "weight": .number($0.weight), "text": .string($0.text)]) }
            LogicGolden.same(.array(got), c.output, "fieldsOf \(it.id)")
        }
    }

    func testGoldenBodies() throws {
        let g = try LogicGolden.load("golden-find")
        let sets = try sets(g)
        for c in LogicGolden.cases(g, "bodyText") {
            let it = try XCTUnwrap(sets[c.input["set"]?.string ?? ""]?.first { $0.id == c.input["id"]?.string })
            let text = Find.bodyText(it, try field(c.input["field"]))
            if c.input["lengthOnly"]?.bool == true {
                let got: JSONValue = .object(["length": .number(Double(text.utf16.count)), "tail": .string(String(decoding: Array(text.utf16.suffix(12)), as: UTF16.self))])
                LogicGolden.same(got, c.output, "bodyText \(c.input)")
            } else {
                LogicGolden.same(.string(text), c.output, "bodyText \(c.input)")
            }
        }
        for c in LogicGolden.cases(g, "bodyHit") {
            let hit = Find.bodyHit(c.input["hay"]?.string ?? "", c.input["q"]?.string ?? "")
            LogicGolden.same(.object(["score": .number(hit.score), "at": .number(Double(hit.at))]), c.output, "bodyHit \(c.input)")
        }
    }

    func testGoldenAlreadyShelved() throws {
        let g = try LogicGolden.load("golden-find")
        let main = try XCTUnwrap(try sets(g)["main"])
        for c in LogicGolden.cases(g, "alreadyShelved") {
            let hit = c.input["hit"]
            let got = Find.alreadyShelved(main, key: hit?["key"]?.string, title: hit?["title"]?.string, list: hit?["list"]?.string ?? "")
            LogicGolden.same(.bool(got), c.output, "alreadyShelved \(c.input)")
        }
    }

    // ── the rules, from find-selftest.mjs ────────────────────────────────────
    private let piranesi = logicItem("p", "books", "Piranesi", subtitle: "Susanna Clarke · 2020",
                                     canonical: ["author": "Susanna Clarke", "year": 2020, "key": "books:/works/OL1W"], created: "2026-02-01T00:00:00.000Z")
    private let ganapati = logicItem("g", "restaurants", "Ganapati", subtitle: "South Indian · Peckham", note: "Go early on a Saturday, the dosa sells out by two.",
                                     canonical: ["city": "London", "area": "Peckham", "cuisine": ["south indian"]])
    private let bookBar = logicItem("bb", "places", "Book Bar", subtitle: "Bounds Green")
    private let dal = logicItem("d", "recipes", "Lemon dal", subtitle: "45 min · 4 servings", canonical: [
        "author": "Meera Sodha", "cuisine": "Indian", "total_time": "45 min", "recipe_url": "https://food.example/dal",
        "article": ["byline": "Words by Jay Rayner", "siteName": "The Guardian", "readingMinutes": 4, "hero": "https://cdn/d.jpg", "excerpt": "Rinse the pulses",
                    "summary": "Sour first, then sweet: a weeknight supper.",
                    "text": "Rinse the pulses until the water runs clear. Simmer with turmeric for half an hour, then stir through tamarind and a spoon of jaggery. The party trick is to start the tempering late. Mustard seeds, curry leaves and dried chilli go in at the very end."],
    ])
    private var shelf: [Item] {
        [piranesi, ganapati, bookBar,
         logicItem("s", "movies", "Sinners", subtitle: "2025", canonical: ["year": 2025]),
         logicItem("h", "books", "Harry Potter and the Goblet of Fire"),
         logicItem("c", "restaurants", "Café de Flore", canonical: ["city": "Paris"]),
         logicItem("n", "unsorted", nil, note: "the one with the yellow cover"),
         logicItem("q", "quotes", "“Attention is the beginning of devotion.”", subtitle: "Mary Oliver", caption: "mary oliver, upstream"),
         dal,
         logicItem("o", "unsorted", "Screenshot", canonical: ["ocr_text": "MENÚ DEL DÍA\nCroquetas de jamón 9€\nPulpo a la gallega 14€"], created: "2026-03-01T00:00:00.000Z"),
         logicItem("w", "wishlist", "Wool overshirt, olive", subtitle: "Northfield", canonical: ["kind": "product", "price": 65, "currency": "GBP", "brand": "Northfield", "shop_url": "https://shop.example/overshirt"]),
         logicItem("j", "notes", "Brown boots, not black.", note: "Brown boots, not black. Ask Maya about the scarf.", canonical: ["kind": "note"])]
    }

    func testFoldingAndWords() {
        XCTAssertEqual(Find.fold("Café de Flore"), "cafe de flore", "nobody types the accents")
        XCTAssertEqual(Find.fold("Café de Flore", useNormalize: false), "cafe de flore", "the table path folds too")
        XCTAssertEqual(Find.words("St. John's — 26 St John St"), ["st", "john", "s", "26", "st", "john", "st"], "punctuation splits")
        XCTAssertEqual(Find.initials(["harry", "potter"]), "hp")
    }

    func testOneEdit() {
        XCTAssertTrue(Find.withinOneEdit("piranesi", "piranesi"))
        XCTAssertTrue(Find.withinOneEdit("pirenesi", "piranesi"), "one substitution")
        XCTAssertTrue(Find.withinOneEdit("piranes", "piranesi"), "one deletion")
        XCTAssertTrue(Find.withinOneEdit("piiranesi", "piranesi"), "one insertion")
        XCTAssertTrue(Find.withinOneEdit("teh", "the"), "a transposition is one keystroke, not two")
        XCTAssertFalse(Find.withinOneEdit("pxranesx", "piranesi"), "two edits is a different word")
        XCTAssertFalse(Find.withinOneEdit("cat", "dog"))
    }

    func testTokenScoresAreTheRanking() {
        XCTAssertEqual(Find.tokenScore("book", "book"), 1)
        XCTAssertEqual(Find.tokenScore("boo", "book"), 0.85)
        XCTAssertEqual(Find.tokenScore("ook", "book"), 0.55, "mid-word, and only for 3+ letters")
        XCTAssertEqual(Find.tokenScore("oo", "book"), 0, "two letters mid-word is noise, not a match")
        XCTAssertEqual(Find.tokenScore("piranese", "piranesi"), 0.5, "a typo in a long word still lands")
        XCTAssertEqual(Find.tokenScore("cat", "car"), 0, "one edit in a SHORT word is a different word")
        XCTAssertEqual(Find.tokenScore("", "book"), 0)
        XCTAssertGreaterThan(Find.tokenScore("book", "book"), Find.tokenScore("boo", "book"), "exact must outrank prefix — this IS the ordering")
        XCTAssertGreaterThan(Find.tokenScore("boo", "book"), Find.tokenScore("ook", "book"), "prefix must outrank mid-word")
        XCTAssertGreaterThan(Find.tokenScore("ook", "book"), Find.tokenScore("piranese", "piranesi"), "mid-word must outrank a typo")
    }

    func testCatalogueMachineryIsNotIndexed() {
        // `key` is the one that hides from a naive check: not a URL, no leading
        // slash, so ONLY the key-name rule drops it.
        let facts = Find.factsText(["author": .string("Susanna Clarke"), "year": .number(2020), "openlibrary_key": .string("/works/OL1W"),
                                    "image_url": .string("https://covers.openlibrary.org/b/id/42-L.jpg"), "key": .string("books:OL1W"), "place_id": .string("ChIJabc123"),
                                    // Two that only the VALUE rule can drop: the names are ordinary.
                                    "homepage": .string("https://example.org/book"), "path": .string("/works/OL9M")])
        XCTAssertTrue(facts.contains("Susanna Clarke"), "the author is searchable")
        XCTAssertTrue(facts.contains("2020"), "so is the year")
        for junk in ["OL1W", "ChIJabc", "covers", "http", "example", "OL9M"] {
            XCTAssertFalse(facts.contains(junk), "an id that matches every book is a search box that always says yes — \(facts)")
        }
        XCTAssertEqual(Find.factsText(["a": LogicGolden.json(["b": ["c": ["d": ["e": "deep"]]]])]), "", "recursion is bounded")
    }

    func testAnArticleAndAScreenshotAreNotFacts() {
        // Every string is SHORT on purpose: anything over 80 is dropped anyway,
        // and would keep this green with the rule deleted.
        let withBody = Find.factsText(LogicGolden.json([
            "author": "Meera Sodha", "ocr_text": "menu del dia",
            "article": ["byline": "Jay Rayner", "siteName": "Observer", "text": "tamarind and jaggery", "summary": "sour then sweet"],
        ]).object ?? [:])
        XCTAssertEqual(withBody, "Meera Sodha", "only the real fact is left")
        XCTAssertEqual(Find.factsText(["a": LogicGolden.json(["article": "kept", "ocr_text": "kept too"])]), "kept kept too",
                       "only at the top, where the contract puts them — a nested key with the same name is an ordinary fact")
    }

    func testFindsByTheFieldsAPersonRemembers() {
        XCTAssertEqual(ids(shelf, "piranesi").first, "p")
        XCTAssertEqual(ids(shelf, "northfield").first, "w", "a thing to buy is found by who makes it")
        XCTAssertEqual(ids(shelf, "scarf").first, "j", "a note is found by a word that is only in the note")
        XCTAssertEqual(ids(shelf, "piranese").first, "p", "one letter wrong still finds it")
        XCTAssertEqual(ids(shelf, "PIRANESI").first, "p", "case does not matter")
        XCTAssertEqual(ids(shelf, "cafe").first, "c", "no accents typed, accented title found")
        XCTAssertEqual(ids(shelf, "clarke").first, "p", "found by author, which is only in canonical")
        XCTAssertEqual(ids(shelf, "peckham").first, "g", "found by neighbourhood")
        XCTAssertEqual(ids(shelf, "dosa").first, "g", "found by something YOU typed in the note")
        XCTAssertEqual(ids(shelf, "2020").first, "p", "found by year")
        XCTAssertEqual(ids(shelf, "hp").first, "h", "initials, on a title")
        XCTAssertTrue(ids(shelf, "oliver").contains("q"), "a quote is findable by who said it")
        XCTAssertEqual(ids(shelf, "yellow"), ["n"], "an item with no title is still findable by its note")
    }

    func testEveryWordNarrows() {
        XCTAssertEqual(ids(shelf, "clarke piranesi"), ["p"], "two words are an AND, not an OR")
        XCTAssertTrue(ids(shelf, "clarke sinners").isEmpty, "no item has both, so nothing matches")
        XCTAssertEqual(ids(shelf, "tamarind jaggery"), ["d"], "rule 1 holds across a body")
        XCTAssertTrue(ids(shelf, "tamarind sinners").isEmpty)
    }

    func testATitleMatchOutranksABodyMatch() {
        // The film whose NOTE mentions the book goes first in the array, so a
        // tie could not pass.
        let noted = logicItem("x", "movies", "Anatomy of a Fall", note: "reminded me of Piranesi")
        let ordered = Find.search(items: [noted, piranesi], query: "piranesi").hits
        XCTAssertEqual(ordered.map(\.item.id), ["p", "x"], "the BOOK called Piranesi outranks the film whose note mentions it")
        XCTAssertNil(ordered.first?.why, "a title match needs no explanation")
        XCTAssertEqual(ordered.last?.why, .note, "a note match says so")
        XCTAssertTrue(ordered.last?.snippet?.contains("Piranesi") ?? false, "and shows the words")

        // Even the WEAKEST title match — one letter wrong — against an exact
        // word in both an article and a screenshot. Body item first and fresher.
        let mentions = logicItem("bo", "recipes", "Reading list", canonical: ["ocr_text": "piranese", "article": ["text": "piranese piranese piranese"]], created: "2026-09-01T00:00:00.000Z")
        XCTAssertEqual(ids([mentions, piranesi], "piranese"), ["p", "bo"], "a typo'd TITLE outranks an exact word in an article and a screenshot")
        XCTAssertLessThan(Find.weight(.article), 0.5 * Find.weight(.title), "every body is under the weakest title score")
        XCTAssertLessThan(Find.weight(.ocr), 0.5 * Find.weight(.title))
    }

    func testSnippetsExplainTheRowAndCutAtWords() throws {
        let gan = try XCTUnwrap(Find.search(items: shelf, query: "dosa").hits.first)
        XCTAssertEqual(gan.why, .note)
        XCTAssertTrue(gan.snippet?.contains("dosa") ?? false, "the snippet holds what matched")
        XCTAssertLessThanOrEqual(try XCTUnwrap(Find.snippet(of: ganapati, field: .note, terms: ["saturday"], width: 30)).count, 34, "snippets are cut to width")
        XCTAssertNil(Find.snippet(of: piranesi, field: .note, terms: ["x"]), "no text, no snippet")

        // Cutting a cast list at a fixed offset gave "….6 Michael B. Jordan".
        let note = "Ryan Coogler 2025 137 minutes with Michael B. Jordan Hailee Steinfeld Delroy Lindo"
        let long = logicItem("ln", "movies", "Sinners", note: note)
        // At every width, not one: a single width can land on a space by luck.
        for width in stride(from: 20, through: 70, by: 5) {
            let sn = try XCTUnwrap(Find.snippet(of: long, field: .note, terms: ["steinfeld"], width: width))
            let body = sn.trimmingCharacters(in: CharacterSet(charactersIn: "…"))
            let range = try XCTUnwrap(note.range(of: body), "a snippet is verbatim from the text it came from — \(sn)")
            XCTAssertTrue(range.lowerBound == note.startIndex || note[note.index(before: range.lowerBound)] == " ", "a snippet begins at a word boundary, never mid-word (width \(width)) — \(sn)")
            XCTAssertTrue(range.upperBound == note.endIndex || note[range.upperBound] == " ", "…and ends at one (width \(width)) — \(sn)")
            XCTAssertTrue(sn.contains("Steinfeld"), "the matched word is in the snippet, not cut off by the context window (width \(width)) — \(sn)")
        }
        XCTAssertFalse(try XCTUnwrap(Find.snippet(of: long, field: .note, terms: ["ryan"], width: 40)).hasPrefix("…"), "a match at the very start needs no leading ellipsis")
    }

    func testThePhraseBonus() {
        // Both titles hold both words; the decoy goes FIRST so a tie cannot pass.
        XCTAssertEqual(ids([logicItem("z", "books", "The Bar Book"), bookBar], "book bar").first, "bb", "'book bar' is Book Bar, not The Bar Book")
    }

    func testShelfNamesAreWholeWordOnly() {
        let books = ids(shelf, "books")
        XCTAssertEqual(Set(books.prefix(2)), ["h", "p"], "'books' puts the books first, both of them")
        // "Book Bar" is one letter from "books": typo tolerance finds it, BELOW the books.
        XCTAssertGreaterThan(books.firstIndex(of: "bb") ?? -1, 1, "a near-miss title ranks under the shelf it nearly named")
        XCTAssertFalse(ids(shelf, "boo").contains("h"), "'boo' must NOT drag in every book — a partial shelf name is not a filter")
        XCTAssertEqual(ids(shelf, "film").first, "s", "the words people use, not just the label")
        XCTAssertEqual(ids(shelf, "buy"), ["w"])
        XCTAssertEqual(ids(shelf, "note"), ["j"])
    }

    func testCountsAreComputedBeforeTheFilter() {
        let all = Find.search(items: shelf, query: "book")
        XCTAssertGreaterThanOrEqual(all.counts["places"] ?? 0, 1, "a chip can say how many it hides")
        let only = Find.search(items: shelf, query: "book", list: "places")
        XCTAssertFalse(only.hits.isEmpty)
        XCTAssertTrue(only.hits.allSatisfy { $0.item.list == "places" }, "the filter filters")
        XCTAssertEqual(only.counts, all.counts, "…and does not change the counts, which is the whole point")
        XCTAssertGreaterThan(all.total, only.total)
    }

    func testRubbishInAndTheLimit() {
        XCTAssertTrue(Find.search(items: shelf, query: "").hits.isEmpty, "an empty query matches nothing, not everything")
        XCTAssertTrue(Find.search(items: shelf, query: "   ").hits.isEmpty)
        XCTAssertTrue(Find.search(items: shelf, query: nil).hits.isEmpty)
        XCTAssertTrue(Find.search(items: shelf, query: "zzzzqqq").hits.isEmpty, "no match is no match")
        // (No "no shelf, no crash" case: in Swift a shelf is always an array.)
        let limited = Find.search(items: shelf, query: "a", limit: 3)
        XCTAssertEqual(limited.hits.count, 3, "limit is honoured")
        XCTAssertGreaterThan(limited.total, 3, "and total still says how many there were")
    }

    func testFreshnessOnlyBreaksATie() {
        let older = logicItem("o", "books", "Twin", created: "2020-01-01T00:00:00.000Z")
        let newer = logicItem("w", "books", "Twin", created: "2026-08-01T00:00:00.000Z")
        XCTAssertEqual(ids([older, newer], "twin"), ["w", "o"], "same score, newer first")
        // A fresher row with a WORSE match stays below.
        let fresh = logicItem("f", "books", "Twins of the north", created: "2026-09-01T00:00:00.000Z")
        XCTAssertEqual(ids([fresh, older], "twin"), ["o", "f"], "a fresher row never outranks a better match")
        // `resolved_at` is read before `created_at`.
        var resolved = older
        resolved.resolvedAt = "2026-09-09T00:00:00.000Z"
        XCTAssertEqual(ids([newer, resolved], "twin"), ["o", "w"], "resolved_at is the date that counts when there is one")
    }

    func testAlreadyShelved() {
        XCTAssertTrue(Find.alreadyShelved(shelf, key: "books:/works/OL1W", title: "A different edition", list: "books"), "a catalogue key already on a shelf is not offered again")
        XCTAssertTrue(Find.alreadyShelved(shelf, key: "books:/works/OL1W", title: "Other", list: "movies"), "the key alone is enough, whatever the shelf")
        XCTAssertTrue(Find.alreadyShelved(shelf, key: "restaurants:node/999", title: "ganapati", list: "restaurants"), "no shared key, same name, same shelf — still already yours")
        XCTAssertFalse(Find.alreadyShelved(shelf, key: "books:x", title: "Ganapati", list: "books"), "same name on a DIFFERENT shelf is a different thing")
        XCTAssertFalse(Find.alreadyShelved(shelf, key: "movies:7", title: "Sinners 2", list: "movies"), "a near name is not a match")
        // (An empty shelf is covered by the golden cases; a nil one cannot be said in Swift.)
        XCTAssertFalse(Find.alreadyShelved(shelf, key: nil, title: "", list: "unsorted"), "no title is not the same title as the nameless row")
    }

    func testATagIsSearchableAndOutranksAFact() throws {
        // "2020s" and the site name are in NO other field.
        let decade = try XCTUnwrap(Find.search(items: shelf, query: "2020s").hits.first)
        XCTAssertEqual(decade.item.id, "p")
        XCTAssertEqual(decade.why, .tags, "found by a tag that exists nowhere else on the item")
        XCTAssertEqual(decade.snippet, "Susanna Clarke · 2020 · 2020s", "…and the row prints the tags, as tags")
        let site = Find.search(items: shelf, query: "guardian").hits
        XCTAssertEqual(site.map(\.item.id), ["d"])
        XCTAssertEqual(site.first?.why, .tags, "the site an article came from is a tag, and is found as one")
        // The author on the tag outranks the same word in an address. Decoy
        // first and fresher, so a tie could not pass.
        let street = logicItem("st", "restaurants", "Corner Cafe", canonical: ["address": "4 Clarke Street"], created: "2026-09-01T00:00:00.000Z")
        XCTAssertEqual(ids([street, piranesi], "clarke"), ["p", "st"], "a tag match outranks the same word in a fact nobody filters by")
        XCTAssertGreaterThan(Find.weight(.tags), Find.weight(.facts))
        XCTAssertLessThan(Find.weight(.tags), 0.5 * Find.weight(.title), "tags sit under the weakest title match")
    }

    func testArticleText() throws {
        let tam = Find.search(items: shelf, query: "tamarind").hits
        XCTAssertEqual(tam.map(\.item.id), ["d"], "found by a word that is only in the article")
        XCTAssertEqual(tam.first?.why, .article)
        XCTAssertTrue(tam.first?.snippet?.contains("tamarind") ?? false, "the row shows the words around it")
        let raw = Find.bodyText(dal, .article)
        // At every width, not one: a single width can land on a space by luck.
        for width in stride(from: 40, through: 90, by: 5) {
            let sn = try XCTUnwrap(Find.snippet(of: dal, field: .article, terms: ["tamarind"], width: width))
            let body = sn.trimmingCharacters(in: CharacterSet(charactersIn: "…"))
            let range = try XCTUnwrap(raw.range(of: body), "an article snippet is verbatim from the article — \(sn)")
            XCTAssertTrue(range.lowerBound > raw.startIndex && raw[raw.index(before: range.lowerBound)].isWhitespace && sn.contains("tamarind"),
                          "an article snippet begins at a word boundary (width \(width)) — \(sn)")
        }
        let rayner = Find.search(items: shelf, query: "rayner").hits.first
        XCTAssertEqual(rayner?.why, .article, "the byline is searchable — who wrote it is what people remember")
        XCTAssertTrue(rayner?.snippet?.contains("Jay Rayner") ?? false)
        XCTAssertEqual(ids(shelf, "weeknight"), ["d"], "so is the summary")
    }

    func testNoFuzzinessInABody() {
        XCTAssertTrue(Find.bodyHit("the art of it", "art") == (1, 4), "a whole word")
        XCTAssertEqual(Find.bodyHit("an article", "art").score, 0.85, "the start of a word")
        XCTAssertEqual(Find.bodyHit("the party will start", "art").score, 0, "the MIDDLE of a word is not a match in a body")
        XCTAssertEqual(Find.bodyHit("party art", "art").at, 6, "…and it does not stop at the first mid-word occurrence")
        XCTAssertEqual(Find.bodyHit("an article about art", "art").score, 1, "a whole word later beats a prefix sooner")
        XCTAssertEqual(Find.bodyHit("an article about artists", "art").at, 3, "of two word-starts, the FIRST is where the snippet opens")
        XCTAssertEqual(Find.bodyHit("", "art").score, 0)
        XCTAssertEqual(Find.bodyHit("art", "").score, 0)
        XCTAssertTrue(ids(shelf, "amarind").isEmpty, "a mid-word fragment does not find an article — it would find all of them")
        XCTAssertTrue(ids(shelf, "tamarinf").isEmpty, "nor does a typo: one wrong letter against 3,000 words matches something every time")
        // The snippet opens where the MATCH was, not on a mid-word look-alike.
        let artful = logicItem("af", "recipes", "Notes", canonical: ["article": ["text": "The party had to start somewhere, and after an hour of everyone standing about it finally did. Much later, art happened."]])
        XCTAssertTrue(Find.snippet(of: artful, field: .article, terms: ["art"], width: 30)?.contains("art happened") ?? false)
    }

    func testOCRText() {
        let croq = Find.search(items: shelf, query: "croquetas").hits
        XCTAssertEqual(croq.map(\.item.id), ["o"], "a screenshot is found by the words in it")
        XCTAssertEqual(croq.first?.why, .ocr, "and says so")
        XCTAssertTrue(croq.first?.snippet?.contains("Croquetas de jamón") ?? false)
        XCTAssertEqual(ids(shelf, "jamon"), ["o"], "accents fold in a body too")
        XCTAssertEqual(ids(shelf, "menu"), ["o"])
        XCTAssertNil(Find.snippet(of: piranesi, field: .ocr, terms: ["x"]))
        XCTAssertEqual(Find.bodyText(piranesi, .article), "", "no article → no text, no snippet, no crash")
        let wrong = logicItem("wt", "books", "Bare", note: "a note", canonical: ["article": "not an object", "ocr_text": 7])
        XCTAssertEqual(Find.bodyText(wrong, .article) + Find.bodyText(wrong, .ocr), "", "a body that is the wrong type is no body")
        XCTAssertEqual(ids([wrong], "note"), ["wt"], "and the item is still searched")
    }

    func testNoteThenScreenshotThenArticleThenCaption() {
        let inNote = logicItem("n1", "books", "A", note: "saffron")
        let inOcr = logicItem("o1", "books", "B", canonical: ["ocr_text": "saffron"])
        let inArticle = logicItem("a1", "books", "C", canonical: ["article": ["text": "saffron"]])
        let inCaption = logicItem("c1", "books", "D", caption: "saffron")
        XCTAssertEqual(ids([inCaption, inArticle, inOcr, inNote], "saffron"), ["n1", "o1", "a1", "c1"],
                       "your note, then the screenshot's words, then the article, then the caption")
    }

    private let filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor "

    func testALongArticleMustNotDrownASearch() {
        let longRead = logicItem("lr", "recipes", "A long read",
                                 canonical: ["article": ["text": String(repeating: filler, count: 130) + " an aside about susanna clarke " + String(repeating: filler, count: 120)]],
                                 created: "2026-09-01T00:00:00.000Z")
        let drowned = Find.search(items: [longRead, piranesi], query: "clarke").hits
        XCTAssertEqual(drowned.map(\.item.id), ["p", "lr"], "the book by Clarke outranks the 20,000-character article that mentions her")
        XCTAssertEqual(drowned.last?.why, .article)
        XCTAssertLessThan(drowned.last?.snippet?.count ?? 999, 100, "its snippet is the few words around the mention, not the article")
        XCTAssertTrue(drowned.last?.snippet?.contains("susanna clarke") ?? false)
    }

    func testOnlyTheFirstTwentyThousandUnitsOfABodyAreSearched() {
        let tooLong = logicItem("tl", "recipes", "Very long",
                                canonical: ["article": ["text": String(repeating: filler, count: 250) + " earlyword " + String(repeating: filler, count: 20) + " lateword"]])
        XCTAssertEqual(Find.bodyText(tooLong, .article).utf16.count, 20000, "a body is capped")
        XCTAssertEqual(Find.bodyText(logicItem("x", "books", canonical: ["ocr_text": String(repeating: "x", count: 30000)]), .ocr).utf16.count, 20000, "…a screenshot's words too")
        XCTAssertEqual(ids([tooLong], "earlyword"), ["tl"], "inside the cap is found")
        XCTAssertTrue(ids([tooLong], "lateword").isEmpty, "past it is not — the known ceiling of the simple route")
    }

    func testAReplacedBodyIsSearchedOnItsNewText() {
        // The folded copy is kept per item. An article that arrives later must
        // be searchable at once — and the text it replaced must stop matching.
        let before = logicItem("same-cache-id", "places", "Somewhere", canonical: ["ocr_text": "oldword"])
        XCTAssertEqual(ids([before], "oldword"), ["same-cache-id"], "found (and now kept)")
        var after = before
        after.canonical["ocr_text"] = .string("newword")
        XCTAssertEqual(ids([after], "newword"), ["same-cache-id"], "the same item with a replaced text is searched on its NEW text")
        XCTAssertTrue(ids([after], "oldword").isEmpty, "not on a stale copy")
    }

    func testABodyIsFoldedOnceHoweverManyLettersAreTyped() {
        let counted = logicItem("counted-\(UUID().uuidString)", "recipes", "Counted", canonical: ["article": ["text": "some words nobody will search for"]])
        let before = Find.cache.folds
        for term in ["z", "zz", "zzz", "zzzz", "zzzzz"] { _ = Find.search(items: [counted], query: term) }
        XCTAssertEqual(Find.cache.folds - before, 1, "five keystrokes must fold the article once and keep it")
    }

    func testTheEndOfEveryArticleIsReallySearched() {
        let reads = (0..<300).map { i in
            logicItem("r\(i)", "recipes", "Read \(i)", canonical: ["article": ["text": String(repeating: filler, count: 259) + " needle\(i)"]])
        }
        XCTAssertEqual(Find.search(items: reads, query: "needle7").hits.count, 11, "needle7 and needle70…79, at the very END of each one")
    }

    func testEightHundredItemsAreSearchedFastEnoughForEveryKeystroke() {
        // No debounce is the design: a local search that lags is a box people
        // stop trusting. The JS budget is 400ms for these five; a debug build
        // of this port is given the same.
        let many = (0..<800).map { i in
            logicItem("m\(i)", "books", "Item number \(i)", note: "a note with some words in it", canonical: ["author": "Someone Or Other", "year": 2000 + (i % 25)])
        }
        // CPU time, not the wall clock: this Mac runs other builds at the same
        // time, and a busy machine is not a slow search.
        let t0 = clock()
        for term in ["it", "item num", "someone", "2015", "zzz"] { _ = Find.search(items: many, query: term) }
        let ms = Double(clock() - t0) / Double(CLOCKS_PER_SEC) * 1000
        XCTAssertLessThan(ms, 400, "five searches over 800 items took \(Int(ms))ms of CPU")
    }
}
