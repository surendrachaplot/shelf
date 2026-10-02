// ExportTests — Export.swift against the real export.js.
//
// Three promises are defended, as in export-selftest.mjs:
//
//   NOTHING IS LEFT BEHIND   the JSON is the JS's JSON, key for key.
//   NOTHING RUNS             the page is the JS's page, BYTE FOR BYTE — so
//                            every escape the JS makes, this makes.
//   NOTHING LEAKS            a link's code does not travel.
import XCTest
@testable import ShelfCore

final class ExportTests: XCTestCase {
    private func facts(_ n: GoldenNode) -> Facts.Result {
        Facts.Result(lede: n["lede"].isNull ? nil : n["lede"].s,
                     rows: n["rows"].list.map { .init(label: $0["label"].s, value: $0["value"].s) },
                     links: n["links"].list.map { .init(label: $0["label"].s, url: $0["url"].s) })
    }

    /// The page, with the facts JS's own `factsFor` gave: Export.swift alone.
    func testThePageIsByteForByteThePageJsWrites() throws {
        try pages { c, shelf, now, zone in Export.html(shelf, now: now, timeZone: zone) { self.facts(c["facts"][$0.id]) } }
    }

    /// The page as the app will make it: Export.swift AND Facts.swift, with
    /// nothing handed in. This is the one a person's file comes out of.
    func testThePageIsTheSameWithTheSwiftFacts() throws {
        try pages { _, shelf, now, zone in Export.html(shelf, now: now, timeZone: zone) }
    }

    private func pages(_ page: (GoldenNode, Shelf, Date?, TimeZone) -> String) throws {
        for c in try GoldenNode.load("golden-export").cases("export", atLeast: 9) {
            let (i, name) = (c["input"], c["name"].s)
            let shelf = try i["shelf"].decode(Shelf.self)
            let got = page(c, shelf, i["nowMs"].isNull ? nil : i["nowMs"].date, i["tz"].zone)
            let want = c["output"]["html"].s
            if got != want {
                // Not the whole page: where it first differs, and what is there.
                let (g, w) = (Array(got.utf8), Array(want.utf8))
                let at = zip(g, w).enumerated().first { $0.element.0 != $0.element.1 }?.offset ?? min(g.count, w.count)
                let show = { (b: [UInt8]) in String(decoding: b[max(0, at - 60)..<min(b.count, at + 60)], as: UTF8.self) }
                XCTFail("\(name): the page differs at byte \(at) of \(w.count) (Swift has \(g.count))\n  JS:    \(show(w).debugDescription)\n  Swift: \(show(g).debugDescription)")
            }
        }
    }

    /// WHERE THE SWIFT FILE KNOWINGLY DIFFERS, and nowhere else. JS hands an
    /// item out exactly as the file held it. Swift hands it out as the model
    /// writes it (Models.swift), which always writes `resolved_at`, and leaves
    /// out `caption` and `error` when empty and `top` when false, and reads a
    /// status that is not one of the three as `unread`. An item the app wrote
    /// whole ("strict" cases) is equal with no allowance at all.
    private func asTheModelWritesIt(_ js: JSONValue) -> JSONValue {
        guard var file = js.object, let items = file["items"]?.array else { return js }
        file["items"] = .array(items.map { item in
            guard var o = item.object else { return item }
            if o["resolved_at"] == nil { o["resolved_at"] = .null }
            for k in ["caption", "error"] where o[k] == .null { o[k] = nil }
            if o["top"] == .bool(false) { o["top"] = nil }
            if let status = o["status"]?.string, ItemStatus(rawValue: status) == nil { o["status"] = .string("unread") }
            return .object(o)
        })
        return .object(file)
    }

    func testTheJsonIsKeyForKeyTheJsonJsWrites() throws {
        let g = try GoldenNode.load("golden-export")
        XCTAssertEqual(Export.format, g["format"].s)
        XCTAssertEqual(Export.version, g["version"].i)
        var strict = 0, allowed = 0
        for c in g.cases("export", atLeast: 9) {
            let (i, name) = (c["input"], c["name"].s)
            let shelf = try i["shelf"].decode(Shelf.self)
            let text = Export.json(shelf, now: i["nowMs"].isNull ? nil : i["nowMs"].date)
            let got = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
            let js = try JSONDecoder().decode(JSONValue.self, from: Data(c["output"]["json"].s.utf8))
            if i["strict"].b {
                strict += 1
                XCTAssertEqual(got, js, "\(name): the JSON is not the JSON JS writes")
            } else {
                allowed += 1
                XCTAssertNotEqual(got, js, "\(name): this case is here to pin a difference, and there is none")
                XCTAssertEqual(got, asTheModelWritesIt(js), "\(name): the JSON differs by more than the model's known keys")
            }
            XCTAssertEqual(got["items"]?.array?.count, shelf.items.count, "\(name): every item is in the file")
            XCTAssertTrue(text.contains("\n  \"items\" : [") || text.contains("\n  \"items\": ["), "\(name): pretty-printed, so a person can read it")
            // THE LINK CODE IS THE REVOKE KEY. It stays on the phone.
            for link in shelf.links { XCTAssertFalse(text.contains(link.code), "\(name): a link's code is in the export") }
            XCTAssertEqual(got["links"]?.array?.count, shelf.links.count, "\(name): the record that a link was made is kept")
            XCTAssertEqual(Export.json(shelf, now: i["nowMs"].isNull ? nil : i["nowMs"].date), text, "\(name): same shelf, same moment, same bytes")
        }
        XCTAssertGreaterThanOrEqual(strict, 7)
        XCTAssertEqual(allowed, 2)
    }

    func testFilenamesAreTheLocalDay() throws {
        var zones = Set<String>()
        for c in try GoldenNode.load("golden-export").cases("filename", atLeast: 100) {
            let i = c["input"]
            // JS takes any string and treats everything but "html" as json.
            let kind = Export.Kind(rawValue: i["kind"].s) ?? .json
            XCTAssertEqual(Export.filename(kind, now: i["nowMs"].isNull ? nil : i["nowMs"].date, timeZone: i["tz"].zone), c["output"].s, "filename \(i.raw)")
            zones.insert(i["tz"].s)
        }
        XCTAssertGreaterThanOrEqual(zones.count, 4)
    }

    func testEscCoversAllFive() throws {
        for c in try GoldenNode.load("golden-export").cases("esc", atLeast: 10) {
            XCTAssertEqual(Export.esc(c["input"]["text"].s), c["output"].s, "esc(\(c["input"]["text"].s.debugDescription))")
        }
        XCTAssertEqual(Export.esc(nil), "", "nothing escapes to nothing, not to the word nil")
    }
}
