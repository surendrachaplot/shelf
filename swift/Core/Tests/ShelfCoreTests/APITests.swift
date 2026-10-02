// APITests — what goes to the server and what comes back, with no network.
//
// A URLProtocol stands in for the server. The answers it gives are
// Fixtures/api-*.json, which tools/golden/store.mjs writes by running the
// server's OWN route functions — so these are the bytes a phone receives.
import XCTest
@testable import ShelfCore

/// The server, for one test at a time.
final class APIStub: URLProtocol, @unchecked Sendable {
    struct Reply { var status = 200; var body = Data(); var error: URLError.Code?; var hang = false; var drip = false }
    private var stopped = false
    nonisolated(unsafe) static var reply = Reply()
    nonisolated(unsafe) static var requests: [URLRequest] = []
    nonisolated(unsafe) static var bodies: [Data] = []

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [APIStub.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { stopped = true }
    override func startLoading() {
        Self.requests.append(request)
        Self.bodies.append(request.httpBody ?? request.httpBodyStream.map(Self.drain) ?? Data())
        let reply = Self.reply
        if reply.hang { return }   // a server that never answers
        if let code = reply.error { client?.urlProtocol(self, didFailWithError: URLError(code)); return }
        if let url = request.url, let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                                                  headerFields: ["Content-Type": "application/json"]) {
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        }
        if reply.drip {
            // A byte every 50 ms for three seconds: never silent for long
            // enough to trip URLSession's own timeout.
            DispatchQueue.global().async { [self] in
                for _ in 0..<60 where !stopped {
                    usleep(50_000)
                    client?.urlProtocol(self, didLoad: Data("x".utf8))
                }
                if !stopped { client?.urlProtocolDidFinishLoading(self) }
            }
            return
        }
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    /// A body set on a URLRequest reaches a URLProtocol as a stream.
    private static func drain(_ stream: InputStream) -> Data {
        stream.open(); defer { stream.close() }
        var out = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            out.append(buffer, count: n)
        }
        return out
    }
}

final class APITests: XCTestCase {
    private let base = URL(string: "https://shelf.test")!
    private var api: API!

    override func setUp() {
        APIStub.reply = .init()
        APIStub.requests = []
        APIStub.bodies = []
        api = API(base: base, key: "build-key", session: APIStub.session())
    }

    private func answer(_ fixture: String, status: Int = 200) throws {
        APIStub.reply = .init(status: status, body: try StoreFixture.data(fixture))
    }
    private func sent() throws -> (request: URLRequest, body: JSONValue?) {
        let request = try XCTUnwrap(APIStub.requests.last)
        let data = try XCTUnwrap(APIStub.bodies.last)
        return (request, data.isEmpty ? nil : try JSONDecoder().decode(JSONValue.self, from: data))
    }
    private func assertThrows<T>(_ expected: APIError, _ work: @autoclosure () async throws -> T,
                                 file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await work(); XCTFail("did not throw", file: file, line: line) }
        catch { XCTAssertEqual(error as? APIError, expected, file: file, line: line) }
    }

    // MARK: what is sent

    func testTheShelvesSentAreTheOnesInDesignJS() throws {
        let want = try StoreFixture.json("api-shelves.json")["shelves"]?.strings
        XCTAssertEqual(API.shelves, want)
        XCTAssertEqual(API.shelves.count, 8, "all eight, and not the pile")
        XCTAssertFalse(API.shelves.contains("unsorted"))
    }

    func testResolveLinkSendsWhatTheJavaScriptSends() async throws {
        try answer("api-resolve.json")
        _ = try await api.resolveLink(url: "https://fieldnotes.example/x?a=1&b=2", list: "books", homeCity: "London")
        let (request, body) = try sent()
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://shelf.test/api/resolve")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-shelf-key"), "build-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "shelf/1 (iOS; native)")
        XCTAssertEqual(request.timeoutInterval, 60, "a resolve is a scrape, a model call and a lookup: sixty seconds")
        XCTAssertEqual(body, .object([
            "url": .string("https://fieldnotes.example/x?a=1&b=2"), "list": .string("books"), "home_city": .string("London"),
            "shelves": .array(["books", "restaurants", "movies", "recipes", "quotes", "places", "wishlist", "notes"].map { .string($0) }),
        ]))

        _ = try await api.resolveLink(url: "https://x", list: "unsorted")
        XCTAssertEqual(try sent().body?["home_city"], .string(""), "no home city is an empty string, as the JavaScript sends")
    }

    func testTheUserAgentIsNotABrowsers() {
        // api/legacy.js refuses /^mozilla\//i — the old shelf was once handed to every visitor of the web app.
        XCTAssertFalse(API.userAgent.lowercased().hasPrefix("mozilla/"))
    }

    func testNoKeyNoHeader() async throws {
        try answer("api-resolve-empty.json")
        for key in [nil, ""] as [String?] {
            _ = try await API(base: base, key: key, session: APIStub.session()).resolveLink(url: "https://x", list: "books")
            XCTAssertNil(try sent().request.value(forHTTPHeaderField: "x-shelf-key"), "a dev build sends no key at all")
        }
    }

    func testResolveImageSendsThePictureAndTheShelves() async throws {
        try answer("api-resolve-image.json")
        let got = try await api.resolveImage(base64: "AAAA", mediaType: "image/png", list: "movies")
        let (request, body) = try sent()
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/resolve/image")
        XCTAssertEqual(request.timeoutInterval, 60)
        XCTAssertEqual(body, .object(["image_b64": .string("AAAA"), "media_type": .string("image/png"), "list": .string("movies"),
                                      "shelves": .array(API.shelves.map { .string($0) })]))
        XCTAssertEqual(got.resolver, "screenshot")
        XCTAssertEqual(got.items.map(\.title), ["Inception"])
        XCTAssertEqual(got.items[0].canonical["ocr_text"]?.string, "INCEPTION\nIn cinemas July 16", "the words read off the pixels ride on canonical")
        XCTAssertNil(got.items[0].sourceURL, "a screenshot has no link to go back to")
        XCTAssertEqual(got.captionChars, 0, "the image route sends no caption count, and that is not an error")
    }

    func testSearchPutsTheTermInTheQueryAndKeepsAPlusAPlus() async throws {
        try answer("api-search.json")
        _ = try await api.search("C++ & café", list: "books", city: "São Paulo")
        let request = try sent().request
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString,
                       "https://shelf.test/api/search?q=C%2B%2B%20%26%20caf%C3%A9&list=books&city=S%C3%A3o%20Paulo")
        XCTAssertEqual(request.timeoutInterval, 15)
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-shelf-key"), "build-key")

        _ = try await api.search("piranesi")
        XCTAssertEqual(try sent().request.url?.absoluteString, "https://shelf.test/api/search?q=piranesi", "no list and no city are left out")
        _ = try await api.search("piranesi", list: "", city: "")
        XCTAssertEqual(try sent().request.url?.query, "q=piranesi")
    }

    func testPublishRevokeStatsAndLegacy() async throws {
        try answer("api-publish.json")
        let published = try await api.publish(["kind": .string("shelf"), "list": .string("books"), "items": .array([])])
        XCTAssertEqual(published, Published(code: "k3x9q2", kind: "shelf"))
        var (request, body) = try sent()
        XCTAssertEqual([request.httpMethod, request.url?.path], ["POST", "/api/publish"])
        XCTAssertEqual(request.timeoutInterval, 12)
        XCTAssertEqual(body, .object(["kind": .string("shelf"), "list": .string("books"), "items": .array([])]))

        try answer("api-revoke.json")
        let revoked = try await api.revokePublish(code: "k3x9q2")
        XCTAssertTrue(revoked)
        (request, body) = try sent()
        XCTAssertEqual([request.httpMethod, request.url?.path], ["POST", "/api/publish/revoke"])
        XCTAssertEqual(body, .object(["code": .string("k3x9q2")]))

        try answer("api-stats.json")
        let views = try await api.publishStats(codes: ["k3x9q2", "p0m4zz", "gone"])
        XCTAssertEqual(views, ["k3x9q2": 12, "p0m4zz": 0], "a code that is no longer live is ABSENT, not zero")
        (request, body) = try sent()
        XCTAssertEqual([request.httpMethod, request.url?.path], ["POST", "/api/publish/stats"])
        XCTAssertEqual(body, .object(["codes": .array([.string("k3x9q2"), .string("p0m4zz"), .string("gone")])]))

        try answer("api-legacy.json")
        let legacy = try await api.legacyExport()
        XCTAssertEqual(legacy.count, 4)
        XCTAssertEqual(legacy.items.map { $0["id"]?.number }, [11, 12, 13, 14])
        XCTAssertNil(legacy.items[1]["canonical"]?.object, "a database null stays a null: the device decides what it means")
        (request, body) = try sent()
        XCTAssertEqual([request.httpMethod, request.url?.path], ["GET", "/api/legacy/export"])
        XCTAssertEqual(request.timeoutInterval, 30)
        XCTAssertNil(body)
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), API.userAgent)
    }

    func testShareURL() {
        XCTAssertEqual(api.shareURL(code: "k3x9q2").absoluteString, "https://shelf.test/s/k3x9q2")
        var named = api!
        named.shareBase = URL(string: "https://shelf.example")
        XCTAssertEqual(named.shareURL(code: "k3x9q2").absoluteString, "https://shelf.example/s/k3x9q2")
    }

    // MARK: what comes back

    func testAResolvedShareDecodesIntoItemsWithNothingLost() async throws {
        try answer("api-resolve.json")
        let got = try await api.resolveLink(url: "https://fieldnotes.example/x", list: "books")
        XCTAssertEqual(got.resolver, "web-og")
        XCTAssertEqual(got.captionChars, 22)
        XCTAssertEqual(got.items.map(\.title), ["One", "Two"])
        let one = got.items[0]
        XCTAssertEqual([one.list, one.subtitle, one.note], ["books", "A. Writer", "The one to start with."])
        XCTAssertEqual(one.imageURL, "https://covers.example/one.jpg")
        XCTAssertEqual(one.sourceURL, "https://fieldnotes.example/x")
        XCTAssertEqual(one.confidence, 0.9)
        XCTAssertTrue(one.enriched)
        XCTAssertEqual(one.caption, "Two books: One and Two")
        XCTAssertEqual(one.canonical["isbn"]?.string, "978")
        XCTAssertEqual(one.canonical["rating"]?.number, 4.21)
        XCTAssertEqual(one.canonical["article"]?["siteName"]?.string, "Field Notes", "the article rides on the first item")
        XCTAssertEqual(one.extra["checked"], .null, "a key the model does not name is carried, not dropped")
        XCTAssertNil(got.items[1].canonical["article"], "and only on the first")
        XCTAssertEqual(got.items[1].extra["checked"]?.string, "corrected")
        XCTAssertEqual(got.items[1].imageURL, "https://fieldnotes.example/og.jpg")
        XCTAssertFalse(got.items[1].enriched)
    }

    func testAShopPageAndAnEmptyAnswer() async throws {
        try answer("api-resolve-product.json")
        let shop = try await api.resolveLink(url: "https://shop.example/overshirt", list: "unsorted")
        XCTAssertEqual(shop.items.map(\.list), ["wishlist"], "a build that says it has a Wishlist gets it on the shelf")
        XCTAssertEqual(shop.items[0].kind, "product")
        XCTAssertEqual(shop.items[0].canonical["price"]?.number, 65)
        XCTAssertEqual(shop.items[0].canonical["price_text"]?.string, "£65.00")

        try answer("api-resolve-empty.json")
        let none = try await api.resolveLink(url: "https://www.instagram.com/reel/empty1/", list: "unsorted")
        XCTAssertEqual(none, ResolveResponse(items: [], resolver: "crawler-embed-html", captionChars: 0),
                       "no items is an honest answer, not an error")
    }

    func testOneBadItemCostsItselfNotTheAnswer() async throws {
        APIStub.reply.body = Data(#"{"ok":true,"resolver":7,"items":[null,{"title":"Kept","list":"books"},"x"]}"#.utf8)
        let got = try await api.resolveLink(url: "https://x", list: "books")
        XCTAssertEqual(got.items.map(\.title), ["Kept"])
        XCTAssertEqual(got.resolver, "none", "a resolver that is not text is no resolver")
    }

    func testSearchResultsDecode() async throws {
        try answer("api-search.json")
        let got = try await api.search("piranesi")
        XCTAssertEqual(got.results.map(\.key), ["books:/works/OL20893680W", "movies:movie/27205", "places:node/123456789"])
        guard got.results.count == 3 else { return }
        XCTAssertEqual(got.results.map(\.id), got.results.map(\.key), "the catalogue key is the identity a list is drawn on")
        XCTAssertEqual(got.results[0].subtitle, "Susanna Clarke · 2020")
        XCTAssertEqual(got.results[0].imageURL, "https://covers.openlibrary.org/b/id/42-M.jpg")
        XCTAssertEqual(got.results[0].canonical["year"]?.number, 2020)
        XCTAssertEqual(got.results[0].canonical["key"]?.string, "books:/works/OL20893680W")
        XCTAssertEqual(got.results[0].provider, "Open Library")
        XCTAssertNil(got.results[1].imageURL)
        XCTAssertEqual(got.results[2].subtitle, "", "the server sends null for no subtitle; the app has an empty string")
        XCTAssertEqual(got.unavailable, [.init(list: "movies", provider: "TMDB")], "a catalogue that is switched off is NAMED")
        XCTAssertEqual(got.mode, "query")

        APIStub.reply.body = Data(#"{"ok":true,"results":[],"unavailable":[]}"#.utf8)   // a term under two letters
        let short = try await api.search("p")
        XCTAssertNil(short.mode, "and it has no mode")
    }

    // MARK: what goes wrong

    func testTheServersOwnSentenceIsTheError() async throws {
        try answer("api-error.json", status: 400)
        await assertThrows(.server("a http(s) url is required", status: 400), try await api.resolveLink(url: "nope", list: "books"))
        XCTAssertEqual(APIError.server("a http(s) url is required", status: 400).localizedDescription, "a http(s) url is required",
                       "and it is what lands on the row")

        // `ok: false` on a 200 is a refusal too.
        APIStub.reply = .init(status: 200, body: Data(#"{"ok":false,"error":"it is not defined"}"#.utf8))
        await assertThrows(.server("it is not defined", status: 200), try await api.resolveLink(url: "https://x", list: "books"))

        APIStub.reply = .init(status: 401, body: Data(#"{"ok":false,"error":"this build is not authorised to use this service"}"#.utf8))
        await assertThrows(.server("this build is not authorised to use this service", status: 401), try await api.search("piranesi"))
    }

    func testAnErrorPageWithNoReasonNamesTheStatus() async {
        APIStub.reply = .init(status: 503, body: Data("<html>Service Unavailable</html>".utf8))
        await assertThrows(.http(503), try await api.publish([:]))
        XCTAssertEqual(APIError.http(503).localizedDescription, "http 503")
        APIStub.reply = .init(status: 500, body: Data(#"{"ok":false}"#.utf8))
        await assertThrows(.http(500), try await api.publishStats(codes: []))
    }

    func testA200ThatIsNotTheAnswerIsABadResponse() async {
        APIStub.reply = .init(status: 200, body: Data("<html>hello</html>".utf8))
        await assertThrows(.badResponse, try await api.resolveLink(url: "https://x", list: "books"))
        APIStub.reply = .init(status: 200, body: Data(#"{"ok":true}"#.utf8))
        await assertThrows(.badResponse, try await api.resolveLink(url: "https://x", list: "books"))
        await assertThrows(.badResponse, try await api.publish([:]))
        APIStub.reply = .init(status: 200, body: Data())
        await assertThrows(.badResponse, try await api.legacyExport())
    }

    func testAServerThatNeverAnswersTimesOut() async {
        APIStub.reply.hang = true
        let started = Date()
        await assertThrows(.timeout, try await api.health(timeout: 0.3))
        XCTAssertLessThan(Date().timeIntervalSince(started), 5, "the clock is ours, not the system's sixty seconds")
        XCTAssertEqual(APIStub.requests.last?.url?.path, "/api/health")
        XCTAssertNotNil(APIError.timeout.errorDescription)
    }

    func testAServerThatDripsBytesStillRunsOutOfTime() async {
        // `timeoutInterval` counts SILENCE, and this server is never silent.
        // The clock in `send` is the only thing that ends it.
        APIStub.reply.drip = true
        let started = Date()
        await assertThrows(.timeout, try await api.health(timeout: 0.4))
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testNoNetworkIsOfflineAndASystemTimeoutIsATimeout() async {
        APIStub.reply.error = .notConnectedToInternet
        var thrown: (any Error)?
        do { _ = try await api.search("piranesi") } catch { thrown = error }
        guard case APIError.offline(let why)? = thrown else { return XCTFail("\(String(describing: thrown))") }
        XCTAssertFalse(why.isEmpty, "and it says why, for the row")
        APIStub.reply.error = .timedOut
        await assertThrows(.timeout, try await api.search("piranesi"))
    }

    func testHealth() async throws {
        APIStub.reply.body = Data(#"{"ok":true,"db":false,"commit":"cadab66"}"#.utf8)
        APIStub.reply.status = 503
        let health = try await api.health()
        XCTAssertEqual(health, ServerHealth(ok: true, db: false), "a server with no database still ANSWERS; that is the news")
        XCTAssertEqual(APIStub.requests.last?.timeoutInterval, 7)
    }
}
