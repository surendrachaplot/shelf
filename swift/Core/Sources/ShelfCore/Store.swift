// Store.swift — your shelves, on your phone, and nowhere else.
//
// A port of app/src/store.ts. One JSON file, `shelf.json`, in a folder the
// caller gives (the app: Documents; a test: a temp folder). Same file names as
// the Expo app, because it IS the Expo app's file: same bundle id, same folder.
//
// THREE RULES, each paid for (HANDOVER, "The shelf that would not open"):
//
//   1. AN EMPTY SHELF AND AN UNREADABLE ONE ARE DIFFERENT ANSWERS. `load` says
//      which. A first launch and a lost file must never look alike.
//   2. NOTHING IS OVERWRITTEN UNTIL IT HAS BEEN COPIED. A file that will not
//      parse is kept once as `shelf.broken.json`; a save that SHRINKS the
//      shelf copies what it replaces to `shelf.prev.json` first.
//   3. A BACKUP NOBODY CAN RESTORE IS NOT A BACKUP. `rescue` reads those
//      copies back, and lifts whole items out of a file cut off mid-write.
//
// And one that is new with this app:
//
//   4. A SAVE WRITES BACK WHAT IT READ. The Expo app may open this file again
//      (a rollback, a TestFlight of the old build). So a key this app does not
//      know is kept at every level, and a key is not added or dropped just
//      because Swift's encoders spell "nothing" differently. See `keepingShape`.
import Foundation

/// `fresh` nothing has ever been saved here. `read` the file opened.
/// `unreadable` there IS a file (or a copy of one) and we could not use it.
enum ShelfState: String, Sendable { case fresh, read, unreadable }

struct Loaded: Sendable {
    var shelf: Shelf
    var state: ShelfState
    /// A sentence for the screen: the byte count and the real error.
    var note: String?
}

/// What an item page can do to an item. Nil means "leave it".
struct ItemEdit: Sendable {
    var list: String?
    var note: String?
    var title: String?
    var top: Bool?
    /// "File it where it is": pending or unread becomes filed.
    var file = false
}

final class Store: @unchecked Sendable {
    let directory: URL
    var file: URL { directory.appendingPathComponent("shelf.json") }
    var tmp: URL { directory.appendingPathComponent("shelf.json.tmp") }
    /// Taken before a save that writes FEWER items than the file holds.
    var prev: URL { directory.appendingPathComponent("shelf.prev.json") }
    /// The bytes of a file we could not read. Written once, never replaced.
    var broken: URL { directory.appendingPathComponent("shelf.broken.json") }

    private let lock = NSLock()
    /// Items in the file at the last good read or write.
    private var onDisk = 0
    /// The file as JSON at the last good read or write. `save` lays the new
    /// shelf over it (rule 4).
    private var raw: JSONValue?

    init(directory: URL) { self.directory = directory }

    private struct Problem: Error { let message: String }

    // MARK: read

    /// Never throws, and never calls a file it could not read an empty shelf.
    func load() -> Loaded {
        lock.lock(); defer { lock.unlock() }
        let fm = FileManager.default
        guard fm.fileExists(atPath: file.path) else {
            // No file is a first launch — UNLESS a copy is beside it. Then
            // something removed the shelf, and that is a loss, not a start.
            let back = rescuableLocked()
            if !back.isEmpty {
                return Loaded(shelf: Shelf(), state: .unreadable,
                              note: "The shelf file isn't there any more. \(Self.count(back.count)) can be put back.")
            }
            return Loaded(shelf: Shelf(), state: .fresh, note: nil)
        }
        var bytes = 0
        do {
            let data = try Data(contentsOf: file)
            bytes = data.count
            let (shelf, json) = try Self.read(data)
            onDisk = shelf.items.count
            raw = json
            return Loaded(shelf: shelf, state: .read, note: nil)
        } catch {
            // THE FILE IS THERE AND WE COULD NOT USE IT. Keep the bytes before
            // anything else happens, then name the cause on the screen.
            keepBroken()
            onDisk = 0
            raw = nil
            let back = rescuableLocked()
            let why = "Couldn't read your shelf file (\(bytes) bytes): \(Self.reason(error))."
            return Loaded(shelf: Shelf(), state: .unreadable,
                          note: back.isEmpty ? "\(why) Nothing has been deleted — the file has been kept."
                                             : "\(why) \(Self.count(back.count)) can be put back.")
        }
    }

    /// Bytes → a shelf, and the JSON it came from. Throws when it is not one.
    private static func read(_ data: Data) throws -> (Shelf, JSONValue) {
        let parsed = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let json = normalise(parsed) else { throw Problem(message: "no items array") }
        let shelf = try JSONDecoder().decode(Shelf.self, from: JSONEncoder().encode(json))
        return (migrate(shelf), json)
    }

    private static func count(_ n: Int) -> String { "\(n) item\(n == 1 ? "" : "s")" }

    /// The parser's own words where it has any ("Unexpected end of file"),
    /// because "the data is not in the correct format" is not a diagnosis.
    private static func reason(_ error: Error) -> String {
        var text = (error as NSError).localizedDescription
        if let p = error as? Problem { text = p.message }
        else if case DecodingError.dataCorrupted(let c) = error {
            let under = (c.underlyingError as NSError?)?.userInfo[NSDebugDescriptionErrorKey] as? String
            text = under ?? c.debugDescription
        }
        while text.hasSuffix(".") || text.hasSuffix(" ") { text.removeLast() }
        return text
    }

    /// TRUST NO KEY OF A FILE ON DISK. Each field is checked for the SHAPE the
    /// code needs, not for being there: `links: null` once emptied a shelf.
    /// Nil only when there is no items array — that is not a shelf at all.
    private static func normalise(_ raw: JSONValue) -> JSONValue? {
        // (An item or a profile of the wrong shape is handled by the decoders in Models.swift.)
        guard var o = raw.object, o["items"]?.array != nil else { return nil }
        o["links"] = .array((o["links"]?.array ?? []).filter { $0.object != nil })
        o["boards"] = .array(boards(o["boards"]))
        return .object(o)
    }

    /// THE SAME RULE, ONE LEVEL DOWN. A file from before lists existed has no
    /// `boards` key, and must read as a shelf with no lists. A board is
    /// REPAIRED, NOT DROPPED: a name and its pins are somebody's work, so a
    /// board with no id is given one. Keys this version does not know stay.
    private static func boards(_ raw: JSONValue?) -> [JSONValue] {
        (raw?.array ?? []).compactMap { $0.object }.map { b in
            var b = b
            let id = b["id"]?.string ?? ""
            b["id"] = .string(id.isEmpty ? idFor(nil) : id)
            b["name"] = .string(b["name"]?.string ?? "")
            b["pins"] = .array((b["pins"]?.strings ?? []).map { .string($0) })
            let query = b["query"]?.string ?? ""
            b["query"] = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(query)
            // (`view` and `created_at` are repaired by Board's own decoder.)
            return .object(b)
        }
    }

    /// Copy an unreadable file aside, ONCE. A second bad boot must not write
    /// over the copy the first one saved: the second file is the emptier one.
    private func keepBroken() {
        let fm = FileManager.default
        if fm.fileExists(atPath: broken.path) || !fm.fileExists(atPath: file.path) { return }
        try? fm.copyItem(at: file, to: broken)   // best effort: never the reason a launch fails
    }

    // MARK: write

    /// Atomic: write beside the file, then rename. A write cut off halfway
    /// leaves the old file or the new one, never half of either.
    func save(_ shelf: Shelf) throws {
        lock.lock(); defer { lock.unlock() }
        let n = shelf.items.count
        // THE ONLY SAVE THAT CAN LOSE ANYTHING writes fewer items than the
        // file holds. Copy first. It is also the undo after a wrong delete.
        if n < onDisk, let old = try? Data(contentsOf: file) { try? old.write(to: prev, options: .atomic) }

        let plain = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(shelf))
        let json = Self.keepingShape(plain, over: raw)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(json).write(to: tmp)
        guard rename(tmp.path, file.path) == 0 else {
            throw Problem(message: "could not replace the shelf file: \(String(cString: strerror(errno)))")
        }
        onDisk = n
        raw = json
    }

    /// Keys the encoders in Models.swift leave out when the value is nil or
    /// false. Every OTHER key that is in the file and not in the encoding is a
    /// key from a later version, and is kept.
    private static let itemOptional: Set<String> = ["caption", "error", "top"]
    private static let boardOptional: Set<String> = ["query"]
    private static let linkOptional: Set<String> = ["target"]

    /// THE NEW SHELF, LAID OVER THE FILE IT CAME FROM (rule 4).
    ///
    /// Swift's encoders and the Expo app do not spell "nothing" the same way:
    /// the Expo app writes `error: null` and `top: false` and leaves
    /// `resolved_at` off a pending row; Models.swift does the opposite of each.
    /// And only `Item` carries its unknown keys. So each object is matched to
    /// its twin in the file (items and boards by id, links by code) and:
    ///   - a value the model has wins, always;
    ///   - a key from the future is kept;
    ///   - a null is not ADDED where the file had no such key;
    ///   - an optional key the model has cleared is dropped, unless the file
    ///     already said "nothing" there, in which case its spelling stays.
    static func keepingShape(_ new: JSONValue, over old: JSONValue?) -> JSONValue {
        guard var n = new.object, let o = old?.object else { return new }
        n["items"] = twins(n["items"], o["items"], by: "id", optional: itemOptional)
        n["boards"] = twins(n["boards"], o["boards"], by: "id", optional: boardOptional)
        n["links"] = twins(n["links"], o["links"], by: "code", optional: linkOptional)
        if let profile = n["profile"] { n["profile"] = laid(profile, over: o["profile"], optional: []) }
        return laid(.object(n), over: old, optional: [])
    }

    private static func twins(_ new: JSONValue?, _ old: JSONValue?, by key: String, optional: Set<String>) -> JSONValue {
        var was: [String: JSONValue] = [:]
        for o in old?.array ?? [] { if let k = o[key]?.string, was[k] == nil { was[k] = o } }
        return .array((new?.array ?? []).map { laid($0, over: $0[key]?.string.flatMap { was[$0] }, optional: optional) })
    }

    private static func laid(_ new: JSONValue, over old: JSONValue?, optional: Set<String>) -> JSONValue {
        guard let n = new.object, var out = old?.object else { return new }
        let saysNothing = { (v: JSONValue?) in v == .null || v == .bool(false) || v == .string("") }
        for k in optional where n[k] == nil && !saysNothing(out[k]) { out[k] = nil }
        for (k, v) in n where !(v == .null && out[k] == nil) { out[k] = v }
        return .object(out)
    }

    // MARK: rescue

    /// PULL WHOLE ITEMS OUT OF BROKEN JSON. A phone that runs out of disk
    /// mid-write leaves a valid PREFIX of a shelf, and a parser refuses all of
    /// it. Every item before the cut is intact, so 40 of 41 books come back.
    ///
    /// Deliberately dumb: walk the items array, take each balanced `{...}`,
    /// stop at the first that does not close. String-aware, because a title
    /// with a brace in it would end the scan early. Never throws: a rescue
    /// that fails is the worst place to fail.
    static func salvage(_ data: Data) -> [Item] {
        // Bytes, not characters: every mark this looks for is ASCII, and a
        // file cut in the middle of a letter is still a file of bytes.
        let raw = [UInt8](data)
        guard let at = raw.firstRange(of: Array("\"items\"".utf8)),
              let open = raw[at.upperBound...].firstIndex(of: UInt8(ascii: "[")) else { return [] }
        var out: [Item] = []
        var depth = 0, start = -1, inString = false, escaped = false
        scan: for i in (open + 1)..<raw.count {
            let ch = raw[i]
            if inString {
                if escaped { escaped = false }
                else if ch == UInt8(ascii: "\\") { escaped = true }
                else if ch == UInt8(ascii: "\"") { inString = false }
                continue
            }
            switch ch {
            case UInt8(ascii: "\""): inString = true
            case UInt8(ascii: "{"):
                if depth == 0 { start = i }
                depth += 1
            case UInt8(ascii: "}"):
                depth -= 1
                if depth == 0 && start >= 0 {
                    // An item that will not parse is one item, not the file.
                    if let it = item(Data(raw[start...i])) { out.append(it) }
                    start = -1
                }
            case UInt8(ascii: "]") where depth == 0: break scan
            default: break
            }
        }
        return out
    }

    static func salvage(_ raw: String) -> [Item] { salvage(Data(raw.utf8)) }

    /// One item out of its own bytes. It must have an id: without one it
    /// cannot be told apart from what is already on the shelf.
    private static func item(_ data: Data) -> Item? {
        // ponytail: a string id only. The JavaScript also takes a number; no
        // file this app or the Expo app wrote has one.
        guard let o = try? JSONDecoder().decode(JSONValue.self, from: data), o["id"]?.string?.isEmpty == false else { return nil }
        return try? JSONDecoder().decode(Item.self, from: data)
    }

    private func itemsIn(_ url: URL) -> [Item] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        if let (shelf, _) = try? Self.read(data) { return shelf.items }
        return Self.salvage(data)   // unparseable, or not a shelf: one more try, per item
    }

    /// What can be put back from the copies beside the shelf, no id twice.
    /// Empty when there is nothing.
    func rescuable() -> [Item] {
        lock.lock(); defer { lock.unlock() }
        return rescuableLocked()
    }

    private func rescuableLocked() -> [Item] {
        var items: [Item] = []
        var seen = Set<String>()
        for url in [prev, broken] {
            for it in itemsIn(url) where !it.id.isEmpty && seen.insert(it.id).inserted { items.append(it) }
        }
        return items
    }

    /// Put the copies back WITHOUT touching what is here. By the time somebody
    /// taps this they may have saved new things; a restore that drops those is
    /// a second loss dressed as a fix.
    func rescue(_ current: Shelf) -> (shelf: Shelf, added: Int) {
        let have = Set(current.items.map(\.id))
        let add = rescuable().filter { !have.contains($0.id) }
        var next = current
        next.items = add + current.items
        return (next, add.count)
    }

    // MARK: pure operations — a Shelf in, a Shelf out

    /// IDS ARE MADE HERE, not by a server. The same seed gives the same id, so
    /// sharing the same reel again lands on the row you already have. No seed
    /// gives a random id: two screenshots are two deliberate saves.
    ///
    /// Byte for byte the JavaScript's: two 32-bit hashes over UTF-16 code
    /// units, `Math.imul` being a multiply that wraps at 32 bits.
    static func idFor(_ seed: String?) -> String {
        guard let seed, !seed.isEmpty else {
            let digits = Array("0123456789abcdefghijklmnopqrstuvwxyz")
            let random = String((0..<10).map { _ in digits[Int.random(in: 0..<36)] })
            return "i_" + random + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        }
        var h1: UInt32 = 0x811c_9dc5, h2: UInt32 = 0x0100_0193
        for unit in seed.utf16 {
            h1 = (h1 ^ UInt32(unit)) &* 16_777_619
            h2 = (h2 &+ UInt32(unit)) &* 2_654_435_761
        }
        return "i_" + String(h1, radix: 36) + String(h2, radix: 36)
    }

    /// RENAMES ARE A DATA PROBLEM. The travel shelf became "places". A shelf
    /// key nothing knows does not error — it falls to the pile, and a rename
    /// shipped without this looks like data loss. Old names stay here for
    /// ever: this phone may not have been opened for a year.
    private static let renamed = ["travel": "places"]
    /// TWO SHELVES THAT ARRIVED AFTER THEIR ITEMS DID. A build with no
    /// Wishlist and no Notes could only put those in the pile. They are told
    /// apart by what they ARE (`canonical.kind`), and they move only FROM the
    /// pile: a product somebody filed under Books stays there.
    private static let homeOf = ["product": "wishlist", "note": "notes"]

    static func migrate(_ shelf: Shelf) -> Shelf {
        var out = shelf
        for i in out.items.indices {
            let it = out.items[i]
            if let to = renamed[it.list] ?? (it.list == "unsorted" ? it.kind.flatMap { homeOf[$0] } : nil) {
                out.items[i].list = to
            }
        }
        // A link you handed out carries a shelf name too.
        for i in out.links.indices {
            if let to = out.links[i].target.flatMap({ renamed[$0] }) { out.links[i].target = to }
        }
        // No rename touches a board: a pin is an item ID, and ids do not move.
        return out
    }

    /// Add it, or lay it over the row with the same id. A RE-SHARE MUST NOT
    /// THROW AWAY THE NOTE YOU WROTE: the catalogue can be replaced, what you
    /// said about the thing cannot. The same goes for the pin, and for the
    /// keys the new row does not speak about (the JavaScript spreads the new
    /// row over the old, and a pending row carries none of these).
    static func upsert(_ shelf: Shelf, _ item: Item) -> Shelf {
        var out = shelf
        guard let at = out.items.firstIndex(where: { $0.id == item.id }) else {
            out.items.insert(item, at: 0)
            return out
        }
        let old = out.items[at]
        var next = item
        if next.note.isEmpty { next.note = old.note }
        next.top = item.top || old.top
        next.caption = item.caption ?? old.caption
        next.resolvedAt = item.resolvedAt ?? old.resolvedAt
        next.error = item.error ?? old.error
        next.extra = old.extra.merging(item.extra) { _, new in new }
        out.items[at] = next
        return out
    }

    static func remove(_ shelf: Shelf, id: String) -> Shelf {
        var out = shelf
        out.items.removeAll { $0.id == id }
        return out
    }

    static func patch(_ shelf: Shelf, id: String, _ change: (inout Item) -> Void) -> Shelf {
        var out = shelf
        for i in out.items.indices where out.items[i].id == id { change(&out.items[i]) }
        return out
    }

    /// Move it, rename it, note it, pin it. (`act` in App.tsx; binning it is `remove`.)
    static func edit(_ shelf: Shelf, id: String, _ edit: ItemEdit) -> Shelf {
        patch(shelf, id: id) { it in
            if edit.file { it.status = .filed }
            if let list = edit.list { it.list = list; it.status = .filed }
            if let note = edit.note {
                it.note = note
                // A note's title IS its first line. Edit the words and the
                // name on the shelf has to follow.
                let words = note.trimmingCharacters(in: .whitespacesAndNewlines)
                if it.kind == "note", !words.isEmpty {
                    let first = words.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
                    it.title = String(first.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
                }
            }
            if let title = edit.title { it.title = title }
            if let top = edit.top { it.top = top }
        }
    }

    /// Filed items on one shelf, in file order (newest first).
    static func shelfOf(_ shelf: Shelf, _ list: String) -> [Item] {
        shelf.items.filter { $0.status == .filed && $0.list == list }
    }

    /// Everything still working itself out, or that we could not name — AND
    /// anything read that belongs to no shelf. A saved essay is filed (so not
    /// "unread") and unsorted (so on no board): without the second clause it
    /// is saved, and visible nowhere.
    static func pileOf(_ shelf: Shelf) -> [Item] {
        shelf.items.filter { $0.status != .filed || $0.list == "unsorted" }
    }

    static func countsOf(_ shelf: Shelf) -> [String: Int] {
        var out: [String: Int] = [:]
        for it in shelf.items where it.status == .filed { out[it.list, default: 0] += 1 }
        return out
    }
}
