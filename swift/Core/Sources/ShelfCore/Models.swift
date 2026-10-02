// Models.swift — the shelf file, as types.
//
// THE FILE FORMAT IS THE EXPO APP'S, byte for byte in meaning: `shelf.json` in
// the app's Documents folder (app/src/store.ts). This app has the same bundle
// id, so installed over the Expo app it opens the same folder and the same
// file. Nothing is migrated because nothing moved — which only stays true
// while every key the old app wrote survives a load and a save here.
//
// So: `canonical` is free-form JSON and is kept as free-form JSON, and every
// type keeps the keys it does not know (`extra`) and writes them back.
import Foundation

/// Any JSON value. `canonical` is whatever a catalogue returned; this app must
/// carry it faithfully even where it reads only a few keys of it.
enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "not JSON") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            // 2020, not 2020.0: a year that comes back with a decimal point is
            // a different string to everything that reads this file.
            if n.rounded() == n, abs(n) < 1e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    subscript(key: String) -> JSONValue? { object?[key] }
    /// Strings out of an array of strings; anything else is dropped.
    var strings: [String] { (array ?? []).compactMap { $0.string }.filter { !$0.isEmpty } }
}

private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

enum ItemStatus: String, Codable, Sendable { case pending, unread, filed }

struct Item: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var list: String
    var status: ItemStatus
    var title: String?
    var subtitle: String
    var note: String
    var imageURL: String?
    var canonical: [String: JSONValue]
    var confidence: Double?
    var enriched: Bool
    var sourceURL: String?
    var resolver: String?
    var caption: String?
    var createdAt: String
    var resolvedAt: String?
    var error: String?
    /// Pinned to the top of the home screen.
    var top: Bool
    /// Keys this app does not know, kept so a save does not drop them.
    var extra: [String: JSONValue] = [:]

    private static let known: Set<String> = [
        "id", "list", "status", "title", "subtitle", "note", "image_url", "canonical", "confidence",
        "enriched", "source_url", "resolver", "caption", "created_at", "resolved_at", "error", "top",
    ]

    init(id: String, list: String, status: ItemStatus = .filed, title: String? = nil, subtitle: String = "",
         note: String = "", imageURL: String? = nil, canonical: [String: JSONValue] = [:], confidence: Double? = nil,
         enriched: Bool = false, sourceURL: String? = nil, resolver: String? = nil, caption: String? = nil,
         createdAt: String = "", resolvedAt: String? = nil, error: String? = nil, top: Bool = false) {
        self.id = id; self.list = list; self.status = status; self.title = title; self.subtitle = subtitle
        self.note = note; self.imageURL = imageURL; self.canonical = canonical; self.confidence = confidence
        self.enriched = enriched; self.sourceURL = sourceURL; self.resolver = resolver; self.caption = caption
        self.createdAt = createdAt; self.resolvedAt = resolvedAt; self.error = error; self.top = top
    }

    /// LENIENT, field by field. A file on disk is checked for the SHAPE each
    /// field needs, not for being present: `{ ...defaults, ...parsed }` once
    /// took a `links: null` and emptied a whole shelf (HANDOVER, 2026-08-13).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        func str(_ k: String) -> String? { (try? c.decode(String.self, forKey: AnyKey(k))) }
        id = str("id") ?? UUID().uuidString
        list = str("list") ?? "unsorted"
        status = ItemStatus(rawValue: str("status") ?? "") ?? .unread
        title = str("title")
        subtitle = str("subtitle") ?? ""
        note = str("note") ?? ""
        imageURL = str("image_url")
        canonical = (try? c.decode([String: JSONValue].self, forKey: AnyKey("canonical"))) ?? [:]
        confidence = try? c.decode(Double.self, forKey: AnyKey("confidence"))
        enriched = (try? c.decode(Bool.self, forKey: AnyKey("enriched"))) ?? false
        sourceURL = str("source_url")
        resolver = str("resolver")
        caption = str("caption")
        createdAt = str("created_at") ?? ""
        resolvedAt = str("resolved_at")
        error = str("error")
        top = (try? c.decode(Bool.self, forKey: AnyKey("top"))) ?? false
        for k in c.allKeys where !Self.known.contains(k.stringValue) {
            if let v = try? c.decode(JSONValue.self, forKey: k) { extra[k.stringValue] = v }
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        for (k, v) in extra { try c.encode(v, forKey: AnyKey(k)) }
        try c.encode(id, forKey: AnyKey("id"))
        try c.encode(list, forKey: AnyKey("list"))
        try c.encode(status, forKey: AnyKey("status"))
        try c.encode(title, forKey: AnyKey("title"))
        try c.encode(subtitle, forKey: AnyKey("subtitle"))
        try c.encode(note, forKey: AnyKey("note"))
        try c.encode(imageURL, forKey: AnyKey("image_url"))
        try c.encode(canonical, forKey: AnyKey("canonical"))
        try c.encode(confidence, forKey: AnyKey("confidence"))
        try c.encode(enriched, forKey: AnyKey("enriched"))
        try c.encode(sourceURL, forKey: AnyKey("source_url"))
        try c.encode(resolver, forKey: AnyKey("resolver"))
        if let caption { try c.encode(caption, forKey: AnyKey("caption")) }
        try c.encode(createdAt, forKey: AnyKey("created_at"))
        try c.encode(resolvedAt, forKey: AnyKey("resolved_at"))
        if let error { try c.encode(error, forKey: AnyKey("error")) }
        if top { try c.encode(true, forKey: AnyKey("top")) }
    }

    /// What kind of thing this is, when the catalogue said: "product", "note",
    /// "picture". Nil for a book, a film and everything else.
    var kind: String? { canonical["kind"]?.string }
}

struct Profile: Codable, Equatable, Sendable {
    var name = ""
    var bio = ""
    var seed = ""
    var homeCity = ""
    enum CodingKeys: String, CodingKey { case name, bio, seed, homeCity = "home_city" }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        name = (try? c?.decode(String.self, forKey: .name)) ?? ""
        bio = (try? c?.decode(String.self, forKey: .bio)) ?? ""
        seed = (try? c?.decode(String.self, forKey: .seed)) ?? ""
        homeCity = (try? c?.decode(String.self, forKey: .homeCity)) ?? ""
    }
}

/// A link you handed out. `code` is also the key that revokes it.
struct PublishedLink: Codable, Equatable, Sendable, Identifiable {
    var code = ""
    var kind = ""
    var target: String?
    var title = ""
    var at = ""
    var id: String { code }
    init(code: String, kind: String, target: String?, title: String, at: String) {
        self.code = code; self.kind = kind; self.target = target; self.title = title; self.at = at
    }
    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        code = (try? c?.decode(String.self, forKey: .code)) ?? ""
        kind = (try? c?.decode(String.self, forKey: .kind)) ?? ""
        target = try? c?.decode(String.self, forKey: .target)
        title = (try? c?.decode(String.self, forKey: .title)) ?? ""
        at = (try? c?.decode(String.self, forKey: .at)) ?? ""
    }
}

/// One of your own lists. `pins` is in the order you arranged them.
struct Board: Codable, Equatable, Sendable, Identifiable {
    enum View: String, Codable, Sendable { case pictures, rows }
    var id: String
    var name: String
    var pins: [String]
    var query: String?
    var view: View
    var createdAt: String
    enum CodingKeys: String, CodingKey { case id, name, pins, query, view, createdAt = "created_at" }
    init(id: String, name: String, pins: [String] = [], query: String? = nil, view: View = .pictures, createdAt: String = "") {
        self.id = id; self.name = name; self.pins = pins; self.query = query; self.view = view; self.createdAt = createdAt
    }
    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        id = (try? c?.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name = (try? c?.decode(String.self, forKey: .name)) ?? "List"
        pins = (try? c?.decode([String].self, forKey: .pins)) ?? []
        query = try? c?.decode(String.self, forKey: .query)
        view = (try? c?.decode(View.self, forKey: .view)) ?? .pictures
        createdAt = (try? c?.decode(String.self, forKey: .createdAt)) ?? ""
    }
}

struct Shelf: Codable, Equatable, Sendable {
    var version = 1
    var items: [Item] = []
    var profile = Profile()
    var links: [PublishedLink] = []
    var boards: [Board] = []

    init(items: [Item] = [], profile: Profile = Profile(), links: [PublishedLink] = [], boards: [Board] = []) {
        self.items = items; self.profile = profile; self.links = links; self.boards = boards
    }

    enum CodingKeys: String, CodingKey { case version, items, profile, links, boards }

    /// Throws ONLY when `items` is not an array — that is a file that is not a
    /// shelf. Every other field falls back to its empty value on its own.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var raw = try c.nestedUnkeyedContainer(forKey: .items)
        var out: [Item] = []
        while !raw.isAtEnd {
            if let it = try? raw.decode(Item.self) { out.append(it) } else { _ = try? raw.decode(JSONValue.self) }
        }
        items = out
        profile = (try? c.decode(Profile.self, forKey: .profile)) ?? Profile()
        links = (try? c.decode([PublishedLink].self, forKey: .links)) ?? []
        boards = (try? c.decode([Board].self, forKey: .boards)) ?? []
    }
}
