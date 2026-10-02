// API.swift — the few things the app asks a server for.
//
// A port of app/src/api.ts. It does NOT ask for your shelves: those are in
// Store.swift, on this phone. This file is for the three jobs a phone cannot
// do alone:
//
//   resolve   turn a link or a screenshot into a named thing (a scrape, then
//             Claude, then a catalogue). Claude needs a key that must never
//             ship in a build.
//   search    the same catalogues, for adding something by name.
//   publish   host a snapshot so a link you hand out opens for somebody with
//             no app. Only what you choose to share ever goes up.
//
// There is no login, because there is nothing to log in to. The build carries
// an app key so a stranger who finds the URL cannot spend the quota; it names
// the BUILD, not you, and it can read nothing.
import Foundation

/// What a failed request says. `errorDescription` is what lands on a row as
/// its `error`, so each case is a sentence somebody can read.
enum APIError: Error, Equatable, LocalizedError {
    /// The server answered, and said why not. Its own words.
    case server(String, status: Int)
    /// Not a 2xx, and no reason in the body (a proxy's error page).
    case http(Int)
    /// A 2xx whose body is not the JSON this app expects.
    case badResponse
    /// Nothing came back in time. Render's free tier can take a minute to wake.
    case timeout
    /// The request did not get there at all.
    case offline(String)

    var errorDescription: String? {
        switch self {
        case .server(let said, _): return said
        case .http(let status): return "http \(status)"
        case .badResponse: return "the server sent something this app can't read"
        case .timeout: return "the server took too long to answer"
        case .offline(let why): return why
        }
    }
}

struct ResolveResponse: Decodable, Equatable, Sendable {
    /// As the server shapes them: no id, no status, no dates — those are this
    /// phone's to give (`Drain.apply`). Decoded as `Item` with its defaults, so
    /// `checked` and anything else the server adds rides along in `extra`.
    var items: [Item]
    /// Which reader answered ("crawler-embed-html", "web-og", "screenshot").
    var resolver: String
    var captionChars: Int

    init(items: [Item] = [], resolver: String = "none", captionChars: Int = 0) {
        self.items = items; self.resolver = resolver; self.captionChars = captionChars
    }
    enum CodingKeys: String, CodingKey { case items, resolver, captionChars = "caption_chars" }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([OneOrNothing<Item>].self, forKey: .items).compactMap(\.value)
        resolver = (try? c.decode(String.self, forKey: .resolver)) ?? "none"
        captionChars = (try? c.decode(Int.self, forKey: .captionChars)) ?? 0
    }
}

struct SearchHit: Decodable, Equatable, Sendable, Identifiable {
    var list: String
    /// The catalogue's own identity for the result ("books:/works/OL1W").
    /// Always there: the server builds it. It is what stops a double add.
    var key: String
    var title: String
    var subtitle: String
    var imageURL: String?
    var canonical: [String: JSONValue]
    var provider: String?
    var id: String { key }

    enum CodingKeys: String, CodingKey { case list, key, title, subtitle, imageURL = "image_url", canonical, provider }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        list = try c.decode(String.self, forKey: .list)
        key = try c.decode(String.self, forKey: .key)
        title = try c.decode(String.self, forKey: .title)
        subtitle = (try? c.decode(String.self, forKey: .subtitle)) ?? ""   // the server sends null for none
        imageURL = try? c.decode(String.self, forKey: .imageURL)
        canonical = (try? c.decode([String: JSONValue].self, forKey: .canonical)) ?? [:]
        provider = try? c.decode(String.self, forKey: .provider)
    }
}

struct SearchResponse: Decodable, Equatable, Sendable {
    /// A catalogue that could not answer, NAMED: "no films matched" and
    /// "films are off because nobody set a key" must not look the same.
    struct Unavailable: Decodable, Equatable, Sendable { var list: String; var provider: String }
    var results: [SearchHit]
    var unavailable: [Unavailable]
    /// "query", or "url" when the term was a recipe link.
    var mode: String?

    enum CodingKeys: String, CodingKey { case results, unavailable, mode }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        results = try c.decode([OneOrNothing<SearchHit>].self, forKey: .results).compactMap(\.value)
        unavailable = ((try? c.decode([OneOrNothing<Unavailable>].self, forKey: .unavailable)) ?? []).compactMap(\.value)
        mode = try? c.decode(String.self, forKey: .mode)
    }
}

struct Published: Decodable, Equatable, Sendable { var code: String; var kind: String }

struct LegacyExport: Decodable, Equatable, Sendable {
    var count: Int
    /// Rows of the old server-side store, as its database held them.
    var items: [[String: JSONValue]]
}

struct ServerHealth: Decodable, Equatable, Sendable { var ok: Bool?; var db: Bool? }

/// One element of an array that may hold a bad one: it costs itself, not the list.
private struct OneOrNothing<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

/// The two calls the drain makes, so a test can stand in for the server.
protocol Resolving: Sendable {
    func resolveLink(url: String, list: String, homeCity: String) async throws -> ResolveResponse
    func resolveImage(base64: String, mediaType: String, list: String) async throws -> ResolveResponse
}

struct API: Resolving, Sendable {
    var base: URL
    /// The build's key. Nil in a dev build: a dev server with no key set lets everything in.
    var key: String?
    var session: URLSession
    /// Where a published link points. The API's own host unless a real domain is set.
    var shareBase: URL?

    init(base: URL, key: String? = nil, session: URLSession = .shared, shareBase: URL? = nil) {
        self.base = base; self.key = key; self.session = session; self.shareBase = shareBase
    }

    /// NOT a browser's. The server refuses a `Mozilla/…` agent on the legacy
    /// route — it was once handing one person's old shelf to every visitor.
    static let userAgent = "shelf/1 (iOS; native)"

    /// Every shelf this build can draw, in shelf order, without the pile. SENT
    /// with every resolve: the server files a thing to buy on Wishlist only
    /// for a build that says it has one; an older build gets it in the pile.
    /// DERIVED from the generated list of shelves: a hand-written list of the
    /// lists goes wrong the next time one is added. APITests checks it against
    /// app/src/design.js all the same.
    static let shelves = DesignConstants.listKeys.filter { $0 != "unsorted" }

    /// SIXTY SECONDS, not twelve. A resolve is a scrape, a Claude call and a
    /// catalogue lookup in a row, and the first one of the day also pays for a
    /// sleeping server to wake. A short timeout drops work that was about to
    /// succeed.
    func resolveLink(url: String, list: String, homeCity: String = "") async throws -> ResolveResponse {
        try await post("api/resolve", ["url": .string(url), "list": .string(list), "home_city": .string(homeCity),
                                       "shelves": Self.shelvesJSON], timeout: 60)
    }

    func resolveImage(base64: String, mediaType: String, list: String) async throws -> ResolveResponse {
        try await post("api/resolve/image", ["image_b64": .string(base64), "media_type": .string(mediaType),
                                             "list": .string(list), "shelves": Self.shelvesJSON], timeout: 60)
    }

    func search(_ term: String, list: String? = nil, city: String? = nil) async throws -> SearchResponse {
        var query = [("q", term)]
        if let list, !list.isEmpty { query.append(("list", list)) }
        if let city, !city.isEmpty { query.append(("city", city)) }
        return try await send(request("api/search", query: query, timeout: 15))
    }

    // Publishing: the only thing that ever leaves the phone.

    func publish(_ body: [String: JSONValue]) async throws -> Published {
        try await post("api/publish", body)
    }

    /// Always true from a live server: "that code was not yours" would tell
    /// anybody who asked which codes exist.
    func revokePublish(code: String) async throws -> Bool {
        struct Out: Decodable { var revoked: Bool }
        let out: Out = try await post("api/publish/revoke", ["code": .string(code)])
        return out.revoked
    }

    /// How many times each link was opened. A code that is ABSENT is no longer
    /// live — show that, not a confident zero.
    func publishStats(codes: [String]) async throws -> [String: Int] {
        struct Out: Decodable { var views: [String: Int] }
        let out: Out = try await post("api/publish/stats", ["codes": .array(codes.map { .string($0) })])
        return out.views
    }

    /// One time: whatever the old server-side store still holds. ONLY the
    /// phone app may ask (see `Drain.legacyImport`).
    func legacyExport() async throws -> LegacyExport {
        try await send(request("api/legacy/export", timeout: 30))
    }

    /// Is the server up? SHORT, because it is asked while the app is still
    /// deciding what to draw: an untimed call here once WAS "stuck on the
    /// splash screen".
    func health(timeout: TimeInterval = 7) async throws -> ServerHealth {
        try await send(request("api/health", timeout: timeout), envelope: false)
    }

    func shareURL(code: String) -> URL {
        (shareBase ?? base).appendingPathComponent("s").appendingPathComponent(code)
    }

    // MARK: the one request

    private static var shelvesJSON: JSONValue { .array(shelves.map { .string($0) }) }

    private func post<T: Decodable>(_ path: String, _ body: [String: JSONValue], timeout: TimeInterval = 12) async throws -> T {
        var req = request(path, timeout: timeout)
        req.httpMethod = "POST"
        req.httpBody = try JSONEncoder().encode(body)
        return try await send(req)
    }

    private func request(_ path: String, query: [(String, String)] = [], timeout: TimeInterval = 12) -> URLRequest {
        var url = base.appendingPathComponent(path)
        if !query.isEmpty, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            // By hand: URLComponents leaves "+" alone, and the server reads a
            // "+" in a query as a space. "C++" must not arrive as "C  ".
            let plain = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
            parts.percentEncodedQuery = query.map { k, v in
                "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: plain) ?? "")"
            }.joined(separator: "&")
            url = parts.url ?? url
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if let key, !key.isEmpty { req.setValue(key, forHTTPHeaderField: "x-shelf-key") }
        return req
    }

    /// EVERY REQUEST HAS A CLOCK ON IT. A boot spinner on this app looks
    /// exactly like the splash screen, and was reported as one.
    /// `timeoutInterval` alone is not that clock: it counts silence, and a
    /// server that drips bytes never trips it. So the request is raced against
    /// a sleep, and the loser is cancelled.
    private func send<T: Decodable>(_ req: URLRequest, envelope: Bool = true) async throws -> T {
        let session = self.session
        let limit = req.timeoutInterval
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await withThrowingTaskGroup(of: (Data, URLResponse).self) { group in
                group.addTask { try await session.data(for: req) }
                group.addTask {
                    try await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
                    throw APIError.timeout
                }
                defer { group.cancelAll() }
                guard let first = try await group.next() else { throw APIError.timeout }
                return first
            }
        } catch let e as APIError {
            throw e
        } catch let e as URLError where e.code == .timedOut {
            throw APIError.timeout
        } catch {
            throw APIError.offline(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = try? JSONDecoder().decode(JSONValue.self, from: data)
        // The server's own sentence wins: `{ ok: false, error }` on any status.
        if envelope, !(200..<300).contains(status) || body?["ok"]?.bool == false {
            if let said = body?["error"]?.string, !said.isEmpty { throw APIError.server(said, status: status) }
            throw APIError.http(status)
        }
        guard body != nil, let out = try? JSONDecoder().decode(T.self, from: data) else { throw APIError.badResponse }
        return out
    }
}
