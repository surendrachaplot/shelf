// AppModel.swift — the one piece of state: everything you have saved.
//
// It is a file on this phone (Core/Store.swift). There is no account, no
// token and no server list to be out of step with. Every change goes through
// `commit`: change it in memory, write the file. Saving on every change and
// not on a timer is deliberate — iOS can end a backgrounded app with no
// warning, and a note you typed being gone because a write was still pending
// is not a trade worth a few milliseconds.
//
// Screens read this through `@Environment(AppModel.self)` and never touch the
// Store or the API themselves.
import SwiftUI
import Observation

/// What is shared from the share sheet: one item, a whole shelf, or the card.
struct Sharing: Equatable, Identifiable {
    enum Kind: String { case item, shelf, profile }
    var kind: Kind
    var item: Item? = nil
    var list: String? = nil
    var title: String
    var id: String { "\(kind.rawValue):\(item?.id ?? list ?? "card")" }
}

/// One screen at a time, held in one value. A router for a dozen destinations
/// would hide where you are; this is a word.
enum Route: Equatable { case home, find, add, importPictures, profile, tags, lists }

@MainActor @Observable
final class Nav {
    var screen: Route = .home
    /// The shelf the bookcase shows ("unsorted" is the pile).
    var tab = "books"
    /// The item page that is open, over whatever screen is under it.
    var open: Item?
    /// The saved article being read, over the item it belongs to.
    var reading: Item?
    var sharing: Sharing?
    /// Tags: the tag to open on (nil = the whole index).
    var tagStart: String?
    /// Lists: the list to open on, and the item being added to one.
    var listStart: String?
    var listAdding: Item?
    /// The note writer, and the list a new note is pinned to (nil = none).
    var writing = false
    var writingFor: String?

    func close() { screen = .home }

    /// Open an item from an overlay: the overlay closes first, because it is
    /// painted above the item page and would cover the thing it just found.
    func show(_ item: Item) { listAdding = nil; screen = .home; open = item }

    func showTag(_ key: String?) { open = nil; tagStart = key; screen = .tags }
    func showLists(start: String? = nil, adding: Item? = nil) {
        if adding != nil { open = nil }
        listStart = start; listAdding = adding; screen = .lists
    }
}

@MainActor @Observable
final class AppModel {
    private(set) var shelf = Shelf()
    private(set) var ready = false
    /// How the read went. An empty shelf and a shelf that would not open are
    /// the same picture and completely different news.
    private(set) var state: ShelfState = .fresh
    private(set) var stateNote: String?
    private(set) var canRestore = 0
    var busy = false
    var flash: String?
    /// Cards the person waved away this launch.
    var waved: [String] = []

    let store: Store
    let api: API
    private var draining = false

    init(directory: URL? = nil, api: API? = nil) {
        let dir = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        store = Store(directory: dir)
        let base = (Bundle.main.object(forInfoDictionaryKey: "ShelfAPI") as? String).flatMap(URL.init(string:))
            ?? URL(string: "https://shelf-api-u8xy.onrender.com")!
        self.api = api ?? API(base: base)
    }

    // ── read ────────────────────────────────────────────────────────────────

    var items: [Item] { shelf.items }
    func items(on list: String) -> [Item] { list == "unsorted" ? Store.pileOf(shelf) : Store.shelfOf(shelf, list) }
    var counts: [String: Int] { Store.countsOf(shelf) }
    var pinned: [Item] { Array(shelf.items.filter { $0.top }.prefix(3)) }
    /// One thing worth a second look. `here` is nil until location is asked for.
    func again(now: Date = Date(), here: Serendipity.LatLng? = nil) -> Serendipity.Card? {
        Serendipity.surface(shelf.items, now: now, here: here, limit: 1, seen: waved).first
    }
    func item(_ id: String) -> Item? { shelf.items.first { $0.id == id } }

    // ── boot ────────────────────────────────────────────────────────────────

    func boot() async {
        guard !ready else { return }
        let loaded = store.load()
        var s = loaded.shelf
        // Kept pictures are files in the documents folder, and iOS can move
        // that folder. Re-point them before anything draws.
        for i in s.items.indices {
            if let u = s.items[i].imageURL, u.contains("/pictures/") {
                s.items[i].imageURL = Pictures.rebasePicture(url: u, documents: store.directory)
            }
        }
        shelf = s
        state = loaded.state
        stateNote = loaded.note
        if loaded.state == .unreadable { canRestore = store.rescuable().count }
        ready = true
        await importLegacyOnce()
        await refresh()
    }

    /// Take what the share extension left, then finish anything interrupted.
    /// Runs at launch and every time the app comes to the front.
    func refresh() async {
        guard ready, !draining, state != .unreadable else { return }
        draining = true
        busy = true
        defer { draining = false; busy = false }
        let queue = ShareQueue.take()
        let drained = await Drain.drain(shelf: shelf, queue: queue, api: api) { [weak self] next in
            await self?.adopt(next)
        }
        adopt(drained)
        let resumed = await Drain.resumePending(shelf: shelf, api: api) { [weak self] next in
            await self?.adopt(next)
        }
        adopt(resumed)
    }

    /// The old server-side rows, once, onto an EMPTY shelf. A shelf you have
    /// curated is never overwritten by a months-old export.
    private func importLegacyOnce() async {
        guard shelf.items.isEmpty, state != .unreadable else { return }
        guard let got = try? await api.legacyExport(), got.count > 0 else { return }
        let next = Drain.legacyImport(into: shelf, rows: got.items, now: Date())
        guard next.items.count > shelf.items.count else { return }
        commit(next)
        flash = "Moved \(got.count) item\(got.count == 1 ? "" : "s") onto this phone"
    }

    // ── write ───────────────────────────────────────────────────────────────

    private func adopt(_ next: Shelf) { commit(next) }

    func commit(_ next: Shelf) {
        guard next != shelf else { return }
        shelf = next
        do { try store.save(next) }
        catch { flash = "Could not save your shelf. \(error.localizedDescription)" }
    }

    func edit(_ item: Item, _ change: ItemEdit) { commit(Store.edit(shelf, id: item.id, change)) }
    func remove(_ item: Item) { commit(Store.remove(shelf, id: item.id)) }
    func add(_ item: Item) { commit(Store.upsert(shelf, item)) }
    func setBoards(_ boards: [Board]) {
        guard boards != shelf.boards else { return }
        var s = shelf; s.boards = boards; commit(s)
    }
    func setProfile(_ profile: Profile) { var s = shelf; s.profile = profile; commit(s) }

    func restore() {
        let got = store.rescue(shelf)
        commit(got.shelf)
        state = .read
        stateNote = nil
        canRestore = 0
        flash = "Put \(got.added) back"
    }

    func retry(_ item: Item) async {
        busy = true
        defer { busy = false }
        let next = await Drain.retry(shelf: shelf, item: item, api: api) { [weak self] s in await self?.adopt(s) }
        adopt(next)
    }

    /// A note is an item whose words are the whole of it.
    @discardableResult
    func addNote(_ text: String, pinTo listId: String? = nil) -> Item? {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return nil }
        let now = Drain.iso(Date())
        let first = body.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? body
        let item = Item(id: Store.idFor("note:\(now)"), list: "notes", status: .filed, title: String(first.prefix(80)),
                        note: body, canonical: ["kind": .string("note")], resolver: "note", createdAt: now, resolvedAt: now)
        var s = Store.upsert(shelf, item)
        if let listId { s.boards = ListsLogic.pin(s.boards, id: listId, itemId: item.id) }
        commit(s)
        return item
    }

    /// Pictures the person picked, kept as files next to the shelf.
    func addPictures(_ datas: [Data], pinTo listId: String? = nil) {
        var s = shelf
        for (i, data) in datas.enumerated() {
            let now = Drain.iso(Date())
            let id = Store.idFor("picture:\(now):\(i)")
            guard let url = try? Pictures.keepPicture(data: data, id: id, in: store.directory) else {
                flash = "One picture could not be kept."
                continue
            }
            let item = Item(id: id, list: "unsorted", status: .filed, title: "Picture", imageURL: url.absoluteString,
                            canonical: ["kind": .string("picture")], resolver: "picture", createdAt: now, resolvedAt: now)
            s = Store.upsert(s, item)
            if let listId { s.boards = ListsLogic.pin(s.boards, id: listId, itemId: id) }
        }
        commit(s)
    }

    /// Screenshots from the camera roll, read by the server into items.
    func importScreenshots(_ datas: [Data], list: String) async {
        busy = true
        defer { busy = false }
        // Each picture is kept under a reference the drain can read back.
        var refs: [String: Data] = [:]
        for (i, d) in datas.enumerated() { refs["import-\(Int(Date().timeIntervalSince1970 * 1000))-\(i)"] = d }
        let rows = Drain.pendingRows(forPictures: refs.keys.sorted(), list: list, now: Date())
        let table = refs
        let next = await Drain.read(rows, into: shelf, api: api, picture: { table[$0] }) { [weak self] s in
            await self?.adopt(s)
        }
        adopt(next)
    }

    // ── sharing a shelf with somebody ───────────────────────────────────────

    func publish(_ body: [String: JSONValue], kind: String, target: String?, title: String) async throws -> PublishedLink {
        let got = try await api.publish(body)
        let link = PublishedLink(code: got.code, kind: got.kind.isEmpty ? kind : got.kind, target: target,
                                 title: title, at: Drain.iso(Date()))
        var s = shelf
        s.links.insert(link, at: 0)
        commit(s)
        return link
    }

    /// Optimistic: turning a link off has to feel immediate.
    func revoke(_ code: String) async {
        var s = shelf
        s.links.removeAll { $0.code == code }
        commit(s)
        _ = try? await api.revokePublish(code: code)
    }
}
