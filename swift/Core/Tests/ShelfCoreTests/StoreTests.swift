// StoreTests — the file that holds everything you have saved.
//
// Two kinds of test. GOLDEN: the real store.ts wrote the answers
// (tools/golden/store.mjs → Fixtures/store-*.json) and the port must give the
// same ones. And the cases of app/store-selftest.mjs, by hand: every way a
// JSON file on a phone goes wrong, asserting the same two things each time —
// the app can tell what happened, and the bytes are still there afterwards.
import XCTest
@testable import ShelfCore

/// Fixtures written by tools/golden/store.mjs.
enum StoreFixture {
    static func data(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.resourceURL?.appendingPathComponent("Fixtures/\(name)"), file: file, line: line)
        return try Data(contentsOf: url)
    }
    static func json(_ name: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data(name))
    }
    /// Where two JSON values first differ, as a path — "items[3].error: …".
    static func difference(_ a: JSONValue, _ b: JSONValue, at path: String = "") -> String? {
        switch (a, b) {
        case (.object(let x), .object(let y)):
            for k in Set(x.keys).union(y.keys).sorted() {
                guard let l = x[k] else { return "\(path).\(k): missing on the left" }
                guard let r = y[k] else { return "\(path).\(k): missing on the right" }
                if let d = difference(l, r, at: "\(path).\(k)") { return d }
            }
            return nil
        case (.array(let x), .array(let y)):
            if x.count != y.count { return "\(path): \(x.count) elements against \(y.count)" }
            for (i, (l, r)) in zip(x, y).enumerated() { if let d = difference(l, r, at: "\(path)[\(i)]") { return d } }
            return nil
        default:
            return a == b ? nil : "\(path): \(a) against \(b)"
        }
    }
}

final class StoreTests: XCTestCase {
    private var dir: URL!
    private var store: Store!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-store-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        store = Store(directory: dir)
    }
    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func put(_ name: String, _ text: String) throws { try Data(text.utf8).write(to: dir.appendingPathComponent(name)) }
    private func get(_ name: String) -> String? { try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8) }
    private func has(_ name: String) -> Bool { FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).path) }
    private func onDisk() throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: store.file))
    }

    private func item(_ id: String, _ list: String = "books", _ extra: String = "") -> String {
        """
        {"id":"\(id)","list":"\(list)","status":"filed","title":"\(id)","subtitle":"","note":"","image_url":null,\
        "canonical":{},"confidence":1,"enriched":true,"source_url":null,"resolver":"x","created_at":"2026-01-01T00:00:00.000Z"\(extra)}
        """
    }
    private func shelf(_ items: [String], _ extra: String = "") -> String {
        """
        {"version":1,"items":[\(items.joined(separator: ","))],"profile":{"name":"S","bio":"","seed":"s","home_city":"London"},"links":[]\(extra)}
        """
    }

    // MARK: golden

    func testIdsAreTheJavaScriptsByteForByte() throws {
        struct Row: Decodable { let seed: String; let id: String }
        let rows = try JSONDecoder().decode([Row].self, from: StoreFixture.data("store-ids.json"))
        XCTAssertGreaterThanOrEqual(rows.count, 50, "the golden file holds fifty seeds or more")
        XCTAssertTrue(rows.contains { $0.seed.unicodeScalars.contains { $0.value > 0xFFFF } }, "one of them outside the BMP")
        for row in rows { XCTAssertEqual(Store.idFor(row.seed), row.id, "idFor(\(row.seed.prefix(40)))") }
    }

    func testAnIdWithNoSeedIsRandomAndWellFormed() {
        let a = Store.idFor(nil), b = Store.idFor("")
        XCTAssertNotEqual(a, b, "two saves with no seed are two rows")
        for id in [a, b] {
            XCTAssertTrue(id.hasPrefix("i_") && id.count >= 18, id)
            XCTAssertTrue(id.dropFirst(2).allSatisfy { $0.isASCII && ($0.isNumber || $0.isLowercase) }, id)
        }
    }

    /// PLAN.md rule 1: every key the Expo app wrote survives a load and a save.
    func testTheExpoAppsFileRoundTripsKeyForKey() throws {
        let original = try StoreFixture.json("store-shelf.json")
        // The fixture really does carry what this test is about.
        XCTAssertNotNil(original["future_top"])
        XCTAssertNotNil(original["profile"]?["future_profile"])
        XCTAssertEqual(original["links"]?.array?.filter { $0["future_link"] != nil }.count, 1)
        XCTAssertEqual(original["boards"]?.array?.filter { $0["future_board"] != nil }.count, 1)
        let items = original["items"]?.array ?? []
        XCTAssertEqual(items.filter { $0["future_item"] != nil }.count, 1)
        XCTAssertEqual(items.filter { $0["canonical"]?["future_canonical"] != nil }.count, 1)
        XCTAssertEqual(Set(items.compactMap { $0["list"]?.string }), Set(DesignConstants.listKeys), "all nine list keys")
        XCTAssertTrue(items.contains { $0["status"]?.string == "pending" && $0["resolved_at"] == nil }, "a pending row, as drainShares writes it")
        XCTAssertTrue(items.contains { $0["status"]?.string == "unread" && $0["error"]?.string == "http 503" }, "an unread row with its error")
        XCTAssertTrue(items.contains { $0["error"] == .null } && items.contains { $0["top"] == .bool(false) }, "error: null and top: false, as the Expo app spells them")

        try StoreFixture.data("store-shelf.json").write(to: store.file)
        let loaded = store.load()
        XCTAssertEqual(loaded.state, .read)
        XCTAssertEqual(loaded.shelf.items.count, items.count)
        try store.save(loaded.shelf)
        XCTAssertNil(StoreFixture.difference(original, try onDisk()), "load → save changed the file")

        // And through a SECOND store, as on the next launch.
        let again = Store(directory: dir)
        try again.save(again.load().shelf)
        XCTAssertNil(StoreFixture.difference(original, try onDisk()), "a second trip changed the file")
    }

    func testTheShelvesThePileAndTheCountsMatchTheJavaScript() throws {
        try StoreFixture.data("store-shelf.json").write(to: store.file)
        let shelf = store.load().shelf
        let want = try StoreFixture.json("store-views.json")
        XCTAssertEqual(Store.pileOf(shelf).map(\.id), want["pile"]?.strings)
        XCTAssertTrue(Store.pileOf(shelf).contains { $0.status == .filed && $0.list == "unsorted" }, "a filed thing on no shelf is in the pile")
        for (list, ids) in want["shelves"]?.object ?? [:] {
            XCTAssertEqual(Store.shelfOf(shelf, list).map(\.id), ids.strings, list)
        }
        XCTAssertEqual(Store.countsOf(shelf).mapValues(Double.init), want["counts"]?.object?.compactMapValues(\.number))
    }

    func testMigrationWritesTheFileTheJavaScriptWrites() throws {
        try StoreFixture.data("store-migrate-before.json").write(to: store.file)
        let loaded = store.load()
        let on = { (id: String) in loaded.shelf.items.first { $0.id == id }?.list }
        XCTAssertEqual(on("trip"), "places", "travel becomes places")
        XCTAssertEqual(on("waiting"), "places", "on a pending row too")
        XCTAssertEqual(on("shirt"), "wishlist", "a thing to buy in the pile moves to the Wishlist")
        XCTAssertEqual(on("jot"), "notes", "a note in the pile moves to Notes")
        XCTAssertEqual(on("novel"), "books", "a product somebody filed under Books STAYS there")
        XCTAssertEqual([on("essay"), on("picture"), on("weird")], ["unsorted", "unsorted", "unsorted"])
        XCTAssertEqual(loaded.shelf.links.map(\.target), ["places", "books", nil], "a published link is renamed too")
        XCTAssertEqual(loaded.shelf.boards.first?.pins, ["trip", "shirt"], "a pin is an id, and ids do not move")
        try store.save(loaded.shelf)
        XCTAssertNil(StoreFixture.difference(try StoreFixture.json("store-migrate-after.json"), try onDisk()))
        XCTAssertEqual(Store.migrate(loaded.shelf), loaded.shelf, "a second pass finds nothing left to move")
    }

    func testSalvageLiftsTheItemsTheJavaScriptLifts() throws {
        struct Case: Decodable { let label: String; let raw: String; let ids: [String] }
        let cases = try JSONDecoder().decode([Case].self, from: StoreFixture.data("store-salvage.json"))
        XCTAssertGreaterThanOrEqual(cases.count, 15)
        for c in cases { XCTAssertEqual(Store.salvage(c.raw).map(\.id), c.ids, c.label) }
    }

    func testSalvageSurvivesAFileCutInTheMiddleOfALetter() {
        var bytes = Array(#"{"items":[{"id":"a","title":"x"},{"id":"b","title":"東京"#.utf8)
        bytes.removeLast()   // half of 京
        XCTAssertEqual(Store.salvage(Data(bytes)).map(\.id), ["a"])
    }

    // MARK: 1. the ordinary path

    func testAnEmptyFolderIsAFirstLaunch() {
        let r = store.load()
        XCTAssertEqual(r.state, .fresh)
        XCTAssertNil(r.note)
        XCTAssertEqual(r.shelf, Shelf())
    }

    func testAGoodFileReadsBack() throws {
        try put("shelf.json", shelf([item("a"), item("b")]))
        let r = store.load()
        XCTAssertEqual(r.state, .read)
        XCTAssertEqual(r.shelf.items.map(\.id), ["a", "b"])
        XCTAssertEqual(r.shelf.profile.homeCity, "London")
        XCTAssertEqual(r.shelf.boards, [], "a file from before lists existed has no lists, and still opens")
    }

    // MARK: 2. THE BUG. A file whose shape is wrong is not an empty shelf

    func testAWrongShapedFieldDoesNotCostTheShelf() throws {
        let bad: [(String, String)] = [
            ("links: null", #"{"version":1,"items":[\#(item("a"))],"profile":{"name":"S"},"links":null}"#),
            ("links: a number", #"{"version":1,"items":[\#(item("a"))],"profile":{"name":"S"},"links":7}"#),
            ("links: junk inside", #"{"version":1,"items":[\#(item("a"))],"links":[null,7,"x"]}"#),
            ("profile: null", #"{"version":1,"items":[\#(item("a"))],"profile":null,"links":[]}"#),
            ("profile: a string", #"{"version":1,"items":[\#(item("a"))],"profile":"x","links":[]}"#),
            ("an item that is null", #"{"version":1,"items":[null,\#(item("a")),7,"x"],"links":[]}"#),
            ("boards: null", shelf([item("a")], #","boards":null"#)),
            ("boards: a number", shelf([item("a")], #","boards":7"#)),
            ("boards: an object", shelf([item("a")], #","boards":{"a":1}"#)),
        ]
        for (label, text) in bad {
            try put("shelf.json", text)
            let r = Store(directory: dir).load()
            XCTAssertEqual(r.state, .read, label)
            XCTAssertEqual(r.shelf.items.map(\.id), ["a"], label)
            XCTAssertEqual(r.shelf.links, [], label)
            XCTAssertEqual(r.shelf.boards, [], label)
        }
    }

    func testABoardWithABadFieldIsRepairedNotDropped() throws {
        // Each board is whole but for the one field under test.
        let board = { (id: String, pins: String, query: String, view: String, more: String) in
            #"{"id":"\#(id)","name":"\#(id)","pins":\#(pins),"query":\#(query),"view":"\#(view)","created_at":"2026-01-01"\#(more)}"#
        }
        let boards = [
            board("pins-null", "null", "null", "pictures", ""),
            board("pins-string", #""a,b""#, "null", "pictures", ""),
            board("pins-mixed", #"["a",7,null,"","b",{"id":"c"}]"#, "null", "pictures", ""),
            "null", #""not a board""#, #"["nor","this"]"#,
            board("query-number", "[]", "7", "pictures", ""),
            board("query-blank", "[]", #""   ""#, "pictures", ""),
            board("view-unknown", "[]", "null", "grid", ""),
            board("view-rows", "[]", #""lisbon""#, "rows", #","cover":"a""#),
            #"{"name":"No id, but a name and a pin","pins":["a"]}"#, #"{"id":"bare"}"#,
        ]
        try put("shelf.json", shelf([item("a")], #","boards":[\#(boards.joined(separator: ","))]"#))
        let r = store.load()
        let by = { (id: String) in r.shelf.boards.first { $0.id == id } }
        XCTAssertEqual(r.state, .read)
        XCTAssertEqual(r.shelf.items.count, 1, "one list with a bad field does not cost the shelf")
        XCTAssertEqual(r.shelf.boards.count, 9, "a null, a string and an array are not boards; the other nine are")
        XCTAssertEqual(by("pins-null")?.pins, [])
        XCTAssertEqual(by("pins-string")?.pins, [], "not one pin per letter")
        XCTAssertEqual(by("pins-mixed")?.pins, ["a", "b"], "the real pins keep their order")
        XCTAssertNil(by("query-number")?.query)
        XCTAssertNil(by("query-blank")?.query)
        XCTAssertEqual(by("view-unknown")?.view, .pictures)
        XCTAssertEqual(by("view-rows")?.view, .rows)
        XCTAssertEqual(by("view-rows")?.query, "lisbon")
        let orphan = r.shelf.boards.first { $0.name == "No id, but a name and a pin" }
        XCTAssertEqual(orphan?.pins, ["a"], "a board with no id keeps its name and its pin")
        XCTAssertTrue(orphan?.id.hasPrefix("i_") == true, "and is given an id")
        XCTAssertEqual(by("bare")?.name, "", "a board that is only an id has every field")

        // And the repair is what gets written, with the later version's key kept.
        try store.save(r.shelf)
        let saved = try onDisk()["boards"]?.array ?? []
        XCTAssertEqual(saved.first { $0["id"]?.string == "view-rows" }?["cover"], .string("a"), "a key this version does not know is KEPT")
        XCTAssertEqual(saved.first { $0["id"]?.string == "pins-mixed" }?["pins"], .array([.string("a"), .string("b")]))
        XCTAssertEqual(saved.first { $0["id"]?.string == orphan?.id }?["name"], .string("No id, but a name and a pin"))
    }

    // MARK: 3. a file we cannot read is never called empty

    func testGarbageIsUnreadableAndTheBytesAreKeptOnce() throws {
        let notes = try StoreFixture.json("store-notes.json")
        try put("shelf.json", "{ this is not json")
        let r = store.load()
        XCTAssertEqual(r.state, .unreadable, "garbage is UNREADABLE, not fresh — the whole point")
        XCTAssertEqual(r.shelf.items.count, 0)
        let note = try XCTUnwrap(r.note)
        XCTAssertTrue(note.hasPrefix("Couldn't read your shelf file (18 bytes): "), note)
        XCTAssertTrue(note.hasSuffix(". Nothing has been deleted — the file has been kept."), note)
        let cause = note.dropFirst("Couldn't read your shelf file (18 bytes): ".count).dropLast(". Nothing has been deleted — the file has been kept.".count)
        XCTAssertGreaterThan(cause.count, 8, "the parser's own words, not a shrug: \(cause)")
        XCTAssertFalse(cause.contains("correct format"), "not Foundation's sentence that says nothing: \(cause)")
        XCTAssertEqual(get("shelf.broken.json"), "{ this is not json", "the bytes are kept before anything writes")
        XCTAssertEqual(notes["bad"]?.string?.prefix(42), note.prefix(42), "the same opening as the Expo app's note")

        // The app carries on and saves, and the shelf is usable again.
        try store.save(Shelf(items: [Item(id: "new", list: "books")]))
        XCTAssertEqual(store.load().shelf.items.map(\.id), ["new"])

        // A SECOND BAD BOOT MUST NOT OVERWRITE THE FIRST COPY.
        try put("shelf.json", "{ broken again, and nearly empty")
        XCTAssertEqual(store.load().state, .unreadable)
        XCTAssertEqual(get("shelf.broken.json"), "{ this is not json", "the copy still holds the FIRST file")
    }

    func testAFileThatIsNotAShelfSaysSoInTheJavaScriptsWords() throws {
        try put("shelf.json", #"{"version":1,"items":null}"#)
        let r = store.load()
        XCTAssertEqual(r.state, .unreadable)
        XCTAssertEqual(r.note, try StoreFixture.json("store-notes.json")["notShelf"]?.string)
    }

    // MARK: 4. a write cut off by a full disk

    func testATruncatedShelfIsUnreadableAndItsItemsComeBack() throws {
        let whole = shelf([item("a"), item("b"), item("c")])
        let cut = try XCTUnwrap(whole.range(of: #""id":"c""#)).upperBound
        try put("shelf.json", String(whole[..<whole.index(cut, offsetBy: 40)]))   // 40 characters into the third item
        let r = store.load()
        XCTAssertEqual(r.state, .unreadable)
        XCTAssertTrue(r.note?.hasSuffix(" 2 items can be put back.") == true, r.note ?? "")
        XCTAssertEqual(store.rescuable().map(\.id), ["a", "b"])
        let (back, added) = store.rescue(r.shelf)
        XCTAssertEqual(added, 2)
        XCTAssertEqual(back.items.map(\.id), ["a", "b"])
    }

    // MARK: 5. a save that SHRINKS the shelf copies what it replaces

    func testRemovingAnItemLeavesAnUndoAndAddingOneDoesNot() throws {
        try put("shelf.json", shelf([item("a"), item("b"), item("c")]))
        let loaded = store.load().shelf
        try store.save(Store.remove(loaded, id: "b"))
        XCTAssertEqual(Store.salvage(get("shelf.prev.json") ?? "").map(\.id), ["a", "b", "c"], "the copy holds what was there before")
        XCTAssertEqual(store.load().shelf.items.map(\.id), ["a", "c"])

        try FileManager.default.removeItem(at: store.prev)
        try store.save(Store.upsert(store.load().shelf, Item(id: "d", list: "books")))
        XCTAssertFalse(has("shelf.prev.json"), "a save that only adds copies nothing")
        try store.save(store.load().shelf)
        XCTAssertFalse(has("shelf.prev.json"), "and neither does one that changes nothing")
    }

    func testASaveIsAtomicAndLeavesNoTempFile() throws {
        try store.save(Shelf(items: [Item(id: "a", list: "books")]))
        XCTAssertFalse(has("shelf.json.tmp"))
        XCTAssertEqual(try onDisk()["version"], .number(1))
        XCTAssertEqual(try onDisk()["items"]?.array?.count, 1)
        // A folder that does not exist yet is made.
        let deep = Store(directory: dir.appendingPathComponent("not/yet"))
        try deep.save(Shelf())
        XCTAssertEqual(deep.load().state, .read)
        // And a save that cannot land says so; it does not pretend.
        let blocked = Store(directory: dir.appendingPathComponent("blocked"))
        try FileManager.default.createDirectory(at: blocked.file.appendingPathComponent("in the way"), withIntermediateDirectories: true)
        XCTAssertThrowsError(try blocked.save(Shelf())) { XCTAssertTrue("\($0)".contains("could not replace the shelf file"), "\($0)") }
    }

    // MARK: 6. THE CASE THAT MATTERS: a wipe, and getting it back

    func testAWipedShelfComesBack() throws {
        try put("shelf.json", shelf([item("a"), item("b"), item("c")]))
        var wiped = store.load().shelf
        wiped.items = []
        try store.save(wiped)
        let after = store.load()
        XCTAssertEqual(after.shelf.items.count, 0, "the shelf is now empty, as it would be")
        let (back, added) = store.rescue(after.shelf)
        XCTAssertEqual(added, 3)
        XCTAssertEqual(back.items.map(\.id).sorted(), ["a", "b", "c"])
    }

    func testARestoreMergesAndDropsNothing() throws {
        try put("shelf.prev.json", shelf([item("a"), item("b")]))
        try put("shelf.broken.json", shelf([item("b"), item("c", "travel")]))
        let mine = Shelf(items: [Item(id: "a", list: "books", note: "mine"), Item(id: "z", list: "books")])
        let (back, added) = store.rescue(mine)
        XCTAssertEqual(added, 2, "only what is missing is put back, and no id twice")
        XCTAssertEqual(back.items.map(\.id), ["b", "c", "a", "z"])
        XCTAssertEqual(back.items.first { $0.id == "a" }?.note, "mine", "what is on the shelf is not replaced by the copy")
        XCTAssertEqual(back.items.first { $0.id == "c" }?.list, "places", "a copy is migrated like the file")
        XCTAssertEqual(store.rescue(back).added, 0, "and a second tap adds nothing")
    }

    // MARK: 7. the file is GONE, but a copy is not

    func testAMissingShelfNextToACopyIsALossNotAFirstLaunch() throws {
        try put("shelf.prev.json", shelf([item("a"), item("b")]))
        let r = store.load()
        XCTAssertEqual(r.state, .unreadable)
        XCTAssertEqual(r.note, try StoreFixture.json("store-notes.json")["gone2"]?.string)
        try put("shelf.prev.json", shelf([item("a")]))
        XCTAssertEqual(store.load().note, try StoreFixture.json("store-notes.json")["gone1"]?.string, "one item, not one items")
    }

    // MARK: rule 4 — a save writes back what it read

    func testAClearedFieldIsNotBroughtBackFromTheFile() throws {
        try put("shelf.json", shelf([
            item("failed", "books", #","error":"http 503","top":true,"caption":"old words","future":{"k":1}"#),
            item("fine", "places", #","error":null,"top":false,"caption":"""#),
        ], #","boards":[{"id":"l","name":"L","pins":[],"query":"lisbon","view":"rows","created_at":""}]"#)
            .replacingOccurrences(of: #""links":[]"#, with: #""links":[{"code":"c","kind":"shelf","target":"books","title":"Books","at":""}]"#))
        var s = store.load().shelf
        XCTAssertEqual(s.links.first?.target, "books")
        s.links[0].target = nil
        s = Store.patch(s, id: "failed") { $0.error = nil; $0.top = false; $0.caption = nil; $0.title = "Read now" }
        s.boards[0].query = nil
        try store.save(s)
        let items = try onDisk()["items"]?.array ?? []
        XCTAssertEqual(items[0]["title"], .string("Read now"), "what the model has wins")
        XCTAssertNil(items[0]["error"], "an error that was cleared is gone from the file")
        XCTAssertNil(items[0]["top"], "and a pin that was taken off")
        XCTAssertNil(items[0]["caption"], "and a caption that was dropped")
        XCTAssertEqual(items[0]["future"], .object(["k": .number(1)]), "while a key from the future stays through an edit")
        XCTAssertEqual(items[1]["error"], .null, "the Expo app's own spelling of nothing is left alone")
        XCTAssertEqual(items[1]["top"], .bool(false))
        XCTAssertNil(items[1]["resolved_at"], "and a null is not added where the file had no key")
        XCTAssertNil(try onDisk()["boards"]?.array?.first?["query"], "a saved search that was cleared is gone")
        XCTAssertNil(try onDisk()["links"]?.array?.first?["target"], "and a link's target")

        let again = Store(directory: dir).load().shelf
        XCTAssertNil(again.items[0].error)
        XCTAssertFalse(again.items[0].top)
        XCTAssertNil(again.boards[0].query)

        // A removed item is removed: its old self is not laid back under anything.
        try store.save(Store.remove(again, id: "failed"))
        XCTAssertEqual(try onDisk()["items"]?.array?.compactMap { $0["id"]?.string }, ["fine"])
        // …not even when the same reel is shared again and gets the same id.
        try store.save(Store.upsert(Store.remove(again, id: "failed"), Item(id: "failed", list: "books")))
        XCTAssertEqual(try onDisk()["items"]?.array?.first?["id"], .string("failed"))
        XCTAssertNil(try onDisk()["items"]?.array?.first?["future"], "a row that was binned does not hand its old keys to a new one")
    }

    // MARK: pure operations

    func testUpsertKeepsWhatYouSaidAboutTheThing() {
        var mine = Item(id: "x", list: "books", title: "Old", note: "my note", top: true)
        mine.extra["future"] = .bool(true)
        mine.resolvedAt = "2026-01-01"
        let base = Shelf(items: [Item(id: "other", list: "movies"), mine])

        let reshared = Store.upsert(base, Item(id: "x", list: "movies", status: .pending))
        XCTAssertEqual(reshared.items.map(\.id), ["other", "x"], "the row stays where it was")
        let row = reshared.items[1]
        XCTAssertEqual(row.status, .pending)
        XCTAssertEqual(row.list, "movies")
        XCTAssertNil(row.title, "the catalogue can be replaced")
        XCTAssertEqual(row.note, "my note", "A RE-SHARE MUST NOT THROW AWAY THE NOTE YOU WROTE")
        XCTAssertTrue(row.top, "nor the pin")
        XCTAssertEqual(row.resolvedAt, "2026-01-01")
        XCTAssertEqual(row.extra["future"], .bool(true))

        XCTAssertEqual(Store.upsert(base, Item(id: "x", list: "books", note: "new")).items[1].note, "new", "a new note replaces the old")
        XCTAssertEqual(Store.upsert(base, Item(id: "n", list: "books")).items.map(\.id), ["n", "other", "x"], "a new item goes on top")
    }

    func testPatchRemoveAndEdit() {
        var note = Item(id: "n", list: "unsorted", status: .unread, title: "Old line", canonical: ["kind": .string("note")])
        note.error = "x"
        let base = Shelf(items: [Item(id: "a", list: "unsorted", status: .unread, title: "A"), note])

        XCTAssertEqual(Store.patch(base, id: "a") { $0.title = "B" }.items.map(\.title), ["B", "Old line"], "only the row with that id")
        XCTAssertEqual(Store.patch(base, id: "nobody") { $0.title = "B" }, base)
        XCTAssertEqual(Store.remove(base, id: "a").items.map(\.id), ["n"])

        let moved = Store.edit(base, id: "a", ItemEdit(list: "books")).items[0]
        XCTAssertEqual([moved.list, moved.status.rawValue], ["books", "filed"], "moving it files it")
        XCTAssertEqual(Store.edit(base, id: "a", ItemEdit(file: true)).items[0].status, .filed)
        XCTAssertEqual(Store.edit(base, id: "a", ItemEdit()).items[0], base.items[0], "an edit that says nothing changes nothing")
        XCTAssertEqual(Store.edit(base, id: "a", ItemEdit(top: true)).items[0].top, true)
        XCTAssertEqual(Store.edit(base, id: "a", ItemEdit(title: "Named")).items[0].title, "Named")

        let plain = Store.edit(base, id: "a", ItemEdit(note: "first\nsecond")).items[0]
        XCTAssertEqual([plain.note, plain.title], ["first\nsecond", "A"], "a note on a book does not rename the book")
        let long = String(repeating: "w", count: 90)
        let rewritten = Store.edit(base, id: "n", ItemEdit(note: "\n  \(long)  \nsecond line")).items[1]
        XCTAssertEqual(rewritten.title, String(repeating: "w", count: 80), "a NOTE's title is its first line, cut at 80")
        XCTAssertEqual(Store.edit(base, id: "n", ItemEdit(note: "   ")).items[1].title, "Old line", "an emptied note keeps its name")
        XCTAssertEqual(Store.edit(base, id: "n", ItemEdit(note: "short  \nsecond")).items[1].title, "short", "the first line, without the space after it")
    }
}
