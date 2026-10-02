// DrainTests — a share becomes a row, and the row becomes a thing on a shelf.
//
// The bugs this guards were all reported from a phone ("nothing is coming to
// the shelf", "why is everything stuck on working it out") and none could be
// staged there on purpose. What CAN be asserted is each rule, with the server
// faked and the saves written down in order.
import XCTest
@testable import ShelfCore

/// A resolver that answers from a table and remembers what it was asked.
private final class FakeResolver: Resolving, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [String] = []
    var answers: [String: Result<ResolveResponse, any Error>] = [:]
    var calls: [String] { lock.withLock { log } }

    func resolveLink(url: String, list: String, homeCity: String) async throws -> ResolveResponse {
        lock.withLock { log.append("link \(url) \(list) \(homeCity)") }
        return try (answers[url] ?? .success(ResolveResponse(items: [], resolver: "crawler-embed-html"))).get()
    }
    func resolveImage(base64: String, mediaType: String, list: String) async throws -> ResolveResponse {
        lock.withLock { log.append("image \(mediaType) \(list) \(base64.count)") }
        return try (answers[mediaType] ?? .success(ResolveResponse(items: [], resolver: "screenshot"))).get()
    }
}

/// Every shelf handed to `save`, in order.
private final class Saves: @unchecked Sendable {
    private let lock = NSLock()
    private var all: [Shelf] = []
    var shelves: [Shelf] { lock.withLock { all } }
    func add(_ s: Shelf) { lock.withLock { all.append(s) } }
}

final class DrainTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)   // 2026-09-21T14:13:20.000Z
    private let stamp = "2026-09-21T14:13:20.000Z"
    private let reel = "https://www.instagram.com/reel/C8xYz12AbCd/"

    private func resolved(_ list: String, _ title: String?, note: String = "", caption: String? = "", source: String? = nil) -> Item {
        var it = Item(id: "server-has-no-id", list: list, status: .unread, title: title, subtitle: "sub", note: note,
                      imageURL: "https://img/x.jpg", canonical: ["year": .number(2020)], confidence: 0.9, enriched: true,
                      sourceURL: source, resolver: "crawler-embed-html", caption: caption)
        it.extra["checked"] = .string("confirmed")
        return it
    }
    private func share(url: String? = nil, text: String? = nil, images: [String] = [], list: String = "books",
                       at: String = "2026-10-01T22:15:00.000Z") -> QueuedShare {
        QueuedShare(url: url, text: text, images: images, list: list, at: at)
    }

    // MARK: the row is the receipt

    func testALinkBecomesAPendingRowWithAnIdMadeFromTheLink() {
        let rows = Drain.pendingRows(for: [share(url: reel)], now: now)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].item, Item(id: Store.idFor(reel), list: "books", status: .pending, sourceURL: reel,
                                          createdAt: "2026-10-01T22:15:00.000Z"), "exactly the row drainShares makes")
        XCTAssertEqual(rows[0].item.id, "i_up0ub01jr2r0s", "the id the Expo app gives the same reel, so a re-share lands on the same row")
        XCTAssertNil(rows[0].image)
        XCTAssertEqual(Drain.pendingRows(for: [share(url: reel, list: "movies", at: "x")], now: now)[0].item.id, rows[0].item.id,
                       "whatever shelf was tapped and whenever")
    }

    func testWhenAShareWasMade() {
        let at = { (text: String) in Drain.pendingRows(for: [self.share(url: self.reel, at: text)], now: self.now)[0].item.createdAt }
        XCTAssertEqual(at("2026-10-01T22:15:00Z"), "2026-10-01T22:15:00.000Z", "a date with no fraction is written the Expo app's way")
        XCTAssertEqual(at("1759356900000"), "2025-10-01T22:15:00.000Z", "milliseconds, as the Expo queue wrote them")
        XCTAssertEqual(at(""), stamp, "no date is now")
        XCTAssertEqual(at("yesterday"), stamp)
        XCTAssertEqual(Drain.iso(now), stamp)
    }

    func testWhatCountsAsTheThingShared() {
        let rows = { (s: QueuedShare) in Drain.pendingRows(for: [s], now: self.now) }
        let inText = rows(share(text: "Check this out: https://youtu.be/dQw4w9WgXcQ and tell me"))
        XCTAssertEqual(inText.map(\.item.sourceURL), ["https://youtu.be/dQw4w9WgXcQ"], "a link inside shared text is the link")
        XCTAssertEqual(rows(share(url: "  ", text: "see https://a.example/x")).map(\.item.sourceURL), ["https://a.example/x"], "a blank url is no url")

        let shots = rows(share(images: ["1-a.png", "", "2-b.png"], list: ""))
        XCTAssertEqual(shots.map(\.image), ["1-a.png", "2-b.png"], "one row for each picture")
        XCTAssertEqual(shots.map(\.item.id), [Store.idFor("1-a.png"), Store.idFor("2-b.png")])
        XCTAssertEqual(shots.map(\.item.sourceURL), [nil, nil], "a file path is not a source: it would draw a dead Open button")
        XCTAssertEqual(shots.map(\.item.list), ["unsorted", "unsorted"], "no shelf tapped is the pile")
        XCTAssertEqual(shots.map(\.item.status), [.pending, .pending])

        XCTAssertEqual(rows(share(url: reel, images: ["1-a.png"])).map(\.image), [nil], "a link wins over a picture of it")
        XCTAssertEqual(rows(share(text: "just words")).count, 0, "words with no link and no picture are not a row")
        XCTAssertEqual(Drain.pendingRows(for: [share(url: reel), share(images: ["p.png"]), share(url: "https://b.example")], now: now).count, 3)

        let picked = Drain.pendingRows(forPictures: ["ph://A", "ph://B"], list: "recipes", now: now)
        XCTAssertEqual(picked.map(\.item.id), [Store.idFor("ph://A"), Store.idFor("ph://B")])
        XCTAssertEqual(picked.map(\.image), ["ph://A", "ph://B"])
        XCTAssertEqual(picked[0].item, Item(id: Store.idFor("ph://A"), list: "recipes", status: .pending, createdAt: stamp))
    }

    // MARK: captions

    func testOnlyPlacesAndQuotesKeepTheirCaption() {
        let long = String(repeating: "c", count: 4100)
        XCTAssertEqual(Drain.keepCaption(resolved("places", "A", caption: long))?.count, 4000, "cut at 4000")
        XCTAssertEqual(Drain.keepCaption(resolved("quotes", "A", caption: "who said it")), "who said it")
        XCTAssertEqual(Drain.keepCaption(resolved("places", "A", caption: nil)), "", "a place with no caption has an empty one, as in the Expo app")
        for list in DesignConstants.listKeys where list != "places" && list != "quotes" {
            XCTAssertNil(Drain.keepCaption(resolved(list, "A", caption: "hashtag wall")), list)
        }
    }

    // MARK: an answer lands on its row

    func testTheFirstItemBecomesTheRowAndKeepsWhatIsYours() throws {
        let row = Drain.pendingRows(for: [share(url: reel, list: "unsorted")], now: now)[0]
        var onShelf = row.item
        onShelf.note = "my note"; onShelf.top = true; onShelf.error = "http 503"; onShelf.extra["future"] = .number(1)
        let base = Shelf(items: [Item(id: "other", list: "movies"), onShelf])
        let answer = ResolveResponse(items: [resolved("books", "Piranesi", note: "what the reel said", caption: "cap",
                                                      source: "https://www.instagram.com/reel/C8xYz12AbCd")], resolver: "crawler-embed-html")

        let out = Drain.apply(resolved: .success(answer), to: base, row: row, now: now)
        XCTAssertEqual(out.items.map(\.id), ["other", row.item.id], "the row is patched where it stands; nothing is added")
        let it = out.items[1]
        XCTAssertEqual(it.status, .filed)
        XCTAssertEqual([it.list, it.title, it.subtitle], ["books", "Piranesi", "sub"], "the server's shelf, name and line")
        XCTAssertEqual(it.imageURL, "https://img/x.jpg")
        XCTAssertEqual(it.canonical, ["year": .number(2020)])
        XCTAssertEqual(it.confidence, 0.9)
        XCTAssertTrue(it.enriched)
        XCTAssertEqual(it.resolver, "crawler-embed-html")
        XCTAssertEqual(it.sourceURL, "https://www.instagram.com/reel/C8xYz12AbCd", "the server's tidied link")
        XCTAssertEqual(it.note, "my note", "YOUR note is kept over the reel's")
        XCTAssertTrue(it.top, "and your pin")
        XCTAssertEqual(it.createdAt, "2026-10-01T22:15:00.000Z", "when YOU saved it")
        XCTAssertEqual(it.resolvedAt, stamp)
        XCTAssertNil(it.error, "an old failure is cleared by a good read")
        XCTAssertNil(it.caption, "a book does not keep the caption")
        XCTAssertEqual(it.extra, ["future": .number(1), "checked": .string("confirmed")], "keys from the future and from the server both stay")
        XCTAssertEqual(out.items[0], base.items[0], "and no other row is touched")

        var bare = base
        bare.items[1].note = ""
        XCTAssertEqual(Drain.apply(resolved: .success(answer), to: bare, row: row, now: now).items[1].note, "what the reel said",
                       "with no note of yours, the reel's is used")
        let place = ResolveResponse(items: [resolved("places", "Graça", caption: "10 spots in Lisbon")], resolver: "x")
        XCTAssertEqual(Drain.apply(resolved: .success(place), to: base, row: row, now: now).items[1].caption, "10 spots in Lisbon",
                       "a place keeps the caption: it is the only record of why these were together")
    }

    func testTheRestBecomeSiblingsAndASecondReadLandsOnTheSameOnes() {
        let row = Drain.pendingRows(for: [share(url: reel, list: "places")], now: now)[0]
        let base = Store.upsert(Shelf(), row.item)
        let answer = ResolveResponse(items: [resolved("places", "One", caption: "ten places"), resolved("places", "Two", caption: "ten places"),
                                             resolved("books", "Three", caption: "ten places"), resolved("unsorted", nil)], resolver: "x")
        let out = Drain.apply(resolved: .success(answer), to: base, row: row, now: now)
        XCTAssertEqual(Set(out.items.map(\.id)), [row.item.id, Store.idFor("\(reel)#Two"), Store.idFor("\(reel)#Three"), Store.idFor("\(reel)#null")],
                       "sibling ids are made from the source and the title, as the Expo app makes them")
        XCTAssertEqual(out.items.count, 4)
        let two = out.items.first { $0.title == "Two" }
        XCTAssertEqual(two?.status, .filed)
        XCTAssertEqual(two?.createdAt, row.item.createdAt, "a sibling was saved when the reel was")
        XCTAssertEqual(two?.resolvedAt, stamp)
        XCTAssertEqual(two?.caption, "ten places")
        XCTAssertNil(out.items.first { $0.title == "Three" }?.caption, "a sibling book keeps no caption")

        let again = Drain.apply(resolved: .success(answer), to: Store.edit(out, id: Store.idFor("\(reel)#Two"), ItemEdit(note: "mine")), row: row, now: now)
        XCTAssertEqual(again.items.count, 4, "reading the same reel again grows nothing")
        XCTAssertEqual(again.items.first { $0.title == "Two" }?.note, "mine", "and a note on a sibling is kept")

        var shot = Drain.pendingRows(forPictures: ["ph://A"], list: "books", now: now)[0]
        shot.item.createdAt = "then"
        let fromShot = Drain.apply(resolved: .success(answer), to: Store.upsert(Shelf(), shot.item), row: shot, now: now)
        XCTAssertTrue(fromShot.items.contains { $0.id == Store.idFor("ph://A#Two") }, "a screenshot of a list has siblings too, keyed on the picture")
    }

    func testNothingNameableLeavesTheRowUnreadAndSaysWhoLooked() {
        let row = Drain.pendingRows(for: [share(url: reel)], now: now)[0]
        let out = Drain.apply(resolved: .success(ResolveResponse(items: [], resolver: "youtube-oembed")), to: Store.upsert(Shelf(), row.item), row: row, now: now)
        XCTAssertEqual(out.items.count, 1, "it stays: the link is still a thing you saved")
        XCTAssertEqual(out.items[0].status, .unread)
        XCTAssertEqual(out.items[0].resolver, "youtube-oembed")
        XCTAssertEqual(out.items[0].resolvedAt, stamp)
        XCTAssertEqual(out.items[0].sourceURL, reel)
        XCTAssertNil(out.items[0].error)
    }

    func testAnErrorLeavesTheRowUnreadWithTheReason() {
        let row = Drain.pendingRows(for: [share(url: reel)], now: now)[0]
        let base = Store.upsert(Shelf(), row.item)
        let server = Drain.apply(resolved: .failure(APIError.server("a http(s) url is required", status: 400)), to: base, row: row, now: now)
        XCTAssertEqual(server.items[0].status, .unread)
        XCTAssertEqual(server.items[0].error, "a http(s) url is required", "the server's own sentence")
        XCTAssertNil(server.items[0].resolvedAt, "it was not read")
        XCTAssertEqual(server.items[0].sourceURL, reel, "and it can be read again")
        XCTAssertEqual(Drain.apply(resolved: .failure(APIError.timeout), to: base, row: row, now: now).items[0].error, APIError.timeout.errorDescription)
        XCTAssertEqual(Drain.apply(resolved: .failure(PictureError.gone), to: base, row: row, now: now).items[0].error,
                       "that screenshot is no longer on this phone")
    }

    // MARK: the drain

    func testADrainSavesTheRowsBeforeAnyNetworkAndThenEachAnswer() async throws {
        let images = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-images-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: images) }
        let png = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
        try png.write(to: images.appendingPathComponent("1-shot.png"))
        try png.write(to: images.appendingPathComponent("2-beside-a-link.png"))

        let api = FakeResolver()
        api.answers[reel] = .success(ResolveResponse(items: [resolved("books", "Piranesi")], resolver: "crawler-embed-html"))
        api.answers["https://down.example/x"] = .failure(APIError.http(503))
        api.answers["image/png"] = .success(ResolveResponse(items: [resolved("movies", "Inception")], resolver: "screenshot"))
        let saves = Saves()
        var base = Shelf(items: [Item(id: "old", list: "books")])
        base.profile.homeCity = "London"
        let queue = [share(url: reel, images: ["2-beside-a-link.png"]), share(url: "https://down.example/x", list: "movies"),
                     share(images: ["../../1-shot.png", "9-gone.png"], list: "unsorted")]

        let out = await Drain.drain(shelf: base, queue: queue, api: api, images: images, now: { [now] in now }) { saves.add($0) }

        let all = saves.shelves
        XCTAssertEqual(all.count, 5, "once with the rows, then once after each of the four answers")
        XCTAssertEqual(all[0].items.count, 5)
        XCTAssertEqual(all[0].items.filter { $0.status == .pending }.count, 4, "THE ROW IS THE RECEIPT: all four are on the shelf before any answer")
        XCTAssertEqual(all[0].items.last?.id, "old", "and what was there is still there")
        XCTAssertEqual(all.map { $0.items.filter { $0.status == .pending }.count }, [4, 3, 2, 1, 0], "one row settles at a time, and each is saved")
        XCTAssertEqual(all.last, out)

        XCTAssertEqual(api.calls, ["link \(reel) books London", "link https://down.example/x movies London", "image image/png unsorted \(png.base64EncodedString().count)"],
                       "oldest first, with the home city; the picture that is gone is never posted")
        let by = { (id: String) in out.items.first { $0.id == id } }
        XCTAssertEqual(by(Store.idFor(reel))?.title, "Piranesi")
        XCTAssertEqual(by(Store.idFor("https://down.example/x"))?.error, "http 503")
        XCTAssertEqual(by(Store.idFor("https://down.example/x"))?.status, .unread)
        XCTAssertEqual(by(Store.idFor("../../1-shot.png"))?.title, "Inception", "a picture is found by the last part of its name only")
        XCTAssertEqual(by(Store.idFor("9-gone.png"))?.error, "that screenshot is no longer on this phone")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: images.path), [], "every picture the queue named is cleared away")
    }

    func testAnEmptyQueueSavesNothing() async {
        let saves = Saves()
        let base = Shelf(items: [Item(id: "old", list: "books")])
        let out = await Drain.drain(shelf: base, queue: [], api: FakeResolver(), images: nil) { saves.add($0) }
        XCTAssertEqual(out, base)
        XCTAssertEqual(saves.shelves.count, 0)
    }

    func testReadAgainSaysItIsWorkingFirst() async {
        let api = FakeResolver()
        api.answers[reel] = .success(ResolveResponse(items: [resolved("books", "Piranesi")], resolver: "x"))
        var failed = Item(id: Store.idFor(reel), list: "books", status: .unread, sourceURL: reel, createdAt: "then")
        failed.error = "http 503"
        let saves = Saves()
        let out = await Drain.retry(shelf: Shelf(items: [failed]), item: failed, api: api, now: { [now] in now }) { saves.add($0) }
        XCTAssertEqual(saves.shelves.map { $0.items[0].status }, [.pending, .filed], "the tap shows at once, then the answer")
        XCTAssertNil(saves.shelves[0].items[0].error)
        XCTAssertEqual(out.items[0].title, "Piranesi")
        XCTAssertEqual(out.items[0].createdAt, "then")

        var shot = failed
        shot.sourceURL = nil
        let untouched = await Drain.retry(shelf: Shelf(items: [shot]), item: shot, api: api) { saves.add($0) }
        XCTAssertEqual(untouched.items, [shot], "a row with no link cannot be read again, and is left as it is")
        XCTAssertEqual(saves.shelves.count, 2)
        XCTAssertEqual(api.calls.count, 1)
    }

    // MARK: resume

    func testTheResumePlanIsTheJavaScripts() throws {
        struct Plan: Decodable { let pending: [String]; let retry: [String]; let giveUp: [String]; let why: [String: String] }
        struct Case: Decodable { let name: String; let items: [Item]; let max: Int; let plan: Plan }
        struct Golden: Decodable { let cases: [Case]; let whyLink: String; let whyShot: String }
        let golden = try JSONDecoder().decode(Golden.self, from: StoreFixture.data("store-resume.json"))
        XCTAssertEqual(golden.cases.count, 5)
        for c in golden.cases {
            let plan = Drain.resumePlan(c.items, max: c.max)
            XCTAssertEqual(plan.pending.map(\.id), c.plan.pending, c.name)
            XCTAssertEqual(plan.retry.map(\.id), c.plan.retry, c.name)
            XCTAssertEqual(plan.giveUp.map(\.id), c.plan.giveUp, c.name)
            XCTAssertEqual(plan.retry.count + plan.giveUp.count, plan.pending.count, "EVERY pending row is retried or explained — 'neither' is the bug")
            XCTAssertEqual(Dictionary(uniqueKeysWithValues: plan.giveUp.map { ($0.id, Drain.whyStopped($0)) }), c.plan.why, c.name)
        }
        XCTAssertEqual(Drain.whyStopped(Item(id: "a", list: "books", status: .pending, sourceURL: reel)), golden.whyLink)
        XCTAssertEqual(Drain.whyStopped(Item(id: "b", list: "books", status: .pending)), golden.whyShot)
        XCTAssertEqual(Drain.resumePlan(Array(repeating: Item(id: "a", list: "books", status: .pending, sourceURL: reel), count: 9)).retry.count, 6,
                       "six at a launch unless told otherwise")
    }

    func testResumeExplainsFirstAndThenReads() async {
        let api = FakeResolver()
        api.answers["https://a.example"] = .success(ResolveResponse(items: [resolved("books", "A")], resolver: "x"))
        let link = { (id: String, url: String) in Item(id: id, list: "books", status: .pending, sourceURL: url) }
        let base = Shelf(items: [link("a", "https://a.example"), Item(id: "shot", list: "books", status: .pending),
                                 link("b", "https://b.example"), link("c", "https://c.example"), Item(id: "done", list: "books")])
        let saves = Saves()
        let out = await Drain.resumePending(shelf: base, api: api, max: 2, now: { [now] in now }) { saves.add($0) }

        let all = saves.shelves
        XCTAssertEqual(all.count, 3, "the explanations together, then one save for each read")
        XCTAssertEqual(all[0].items.map(\.status), [.pending, .unread, .pending, .unread, .filed],
                       "what can never finish stops saying it is working BEFORE any slow request")
        XCTAssertEqual(all[0].items[1].error, Drain.whyStopped(base.items[1]))
        XCTAssertEqual(all[0].items[3].error, "Reading this was interrupted — tap Read again", "past the bound: explained, and it keeps Read again")
        XCTAssertEqual(api.calls, ["link https://a.example books ", "link https://b.example books "])
        XCTAssertEqual(out.items.map(\.status), [.filed, .unread, .unread, .unread, .filed], "NOTHING is still working it out")
        XCTAssertEqual(out.items[0].title, "A")

        let quiet = Saves()
        let same = await Drain.resumePending(shelf: out, api: api) { quiet.add($0) }
        XCTAssertEqual(same, out)
        XCTAssertEqual(quiet.shelves.count, 0, "with nothing pending there is nothing to save")
    }

    // MARK: the one-time legacy import

    func testTheOldServerRowsBecomeItems() throws {
        let export = try JSONDecoder().decode(LegacyExport.self, from: StoreFixture.data("api-legacy.json"))
        let items = Drain.legacyRows(export.items, now: now)
        XCTAssertEqual(items.map(\.id), ["11", "12", "13"], "a database number is the id as text; a discarded row stays discarded")
        XCTAssertEqual(items.map(\.status), [.filed, .filed, .unread], "a row with a name is filed, one without is unread")
        XCTAssertEqual(items[0], Item(id: "11", list: "movies", status: .filed, title: "Inception", subtitle: "2010",
                                      imageURL: "https://image.tmdb.org/t/p/w500/x.jpg", canonical: ["tmdb_id": .number(27205)], confidence: 0.9,
                                      enriched: true, sourceURL: "https://www.instagram.com/reel/old1/", resolver: "crawler-embed-html",
                                      createdAt: "2026-03-01T10:00:00.000Z", resolvedAt: "2026-03-01T10:00:05.000Z"))
        XCTAssertEqual([items[1].subtitle, items[1].note], ["", ""], "a database null is an empty line, not a crash")
        XCTAssertEqual(items[1].canonical, [:])
        XCTAssertEqual(Drain.legacyRows([["id": .string("x")]], now: now).first?.createdAt, stamp)
        XCTAssertEqual(Drain.legacyRows([["title": .string("no id")]], now: now).count, 0)

        let shelf = Drain.legacyImport(into: Shelf(), rows: export.items, now: now)
        XCTAssertEqual(shelf.items.map(\.id), ["13", "12", "11"], "newest first, as the Expo app leaves them")
        XCTAssertEqual(shelf.items[1].list, "places", "the old store still says travel")

        let curated = Shelf(items: [Item(id: "mine", list: "books")])
        XCTAssertEqual(Drain.legacyImport(into: curated, rows: export.items, now: now), curated,
                       "A SHELF WITH ANYTHING ON IT IS NEVER OVERWRITTEN BY AN OLD EXPORT")
    }
}
