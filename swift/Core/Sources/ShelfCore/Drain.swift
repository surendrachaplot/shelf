// Drain.swift — what happens to a share after the extension queued it.
//
// A port of `drainShares`, `readLink`, `resumePending`, `importScreenshots`,
// `retry`, `keepCaption` and the legacy import in app/App.tsx, and of
// app/src/resume.js. Pure wherever it can be, so the decisions are tested with
// fixtures instead of by killing an app at the right moment on a phone.
//
// THE ROW IS THE RECEIPT. A share becomes a row saying "Working it out…"
// BEFORE any network happens, and that row is saved. So a share is on your
// shelf the moment the app opens, even if reading it then fails, and even if
// the app is killed halfway. Reading is the slow half, and it may not finish.
import Foundation

/// A row that is waiting to be read, and the picture it is to be read from
/// (nil for a link). The picture is NOT on the item: a file path is not a
/// source, and putting it in `source_url` would draw a dead "Open" button.
struct PendingRow: Equatable, Sendable {
    var item: Item
    var image: String?
}

struct ResumePlan: Equatable, Sendable {
    var pending: [Item]
    var retry: [Item]
    var giveUp: [Item]
}

enum Drain {
    // MARK: captions

    /// WHICH ITEMS KEEP THE CAPTION THEY CAME FROM. Most do not: a film has a
    /// synopsis, and the reel's hashtag wall beside it is clutter. PLACES are
    /// different — one reel becomes ten places, and the caption is the only
    /// record of why those ten were together. QUOTES keep theirs because the
    /// words around a quote are often where the name of who said it lives.
    // deliberate subset — only these two shelves keep the caption.
    static let keepsCaption: Set<String> = ["places", "quotes"]
    static let captionLimit = 4000

    static func keepCaption(_ item: Item) -> String? {
        keepsCaption.contains(item.list) ? String((item.caption ?? "").prefix(captionLimit)) : nil
    }

    // MARK: the queue becomes rows

    /// "2026-10-02T09:58:00.000Z", the way the Expo app writes a date.
    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    /// When a share says it was made: an ISO date, or milliseconds as text.
    private static func date(_ text: String) -> Date? {
        let f = ISO8601DateFormatter()
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            f.formatOptions = options
            if let d = f.date(from: text) { return d }
        }
        return Double(text).flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0 / 1000) : nil }
    }

    private static func pending(id: String, list: String, source: String?, at: String) -> Item {
        Item(id: id, list: list.isEmpty ? "unsorted" : list, status: .pending, sourceURL: source, createdAt: at)
    }

    /// One pending row per thing shared.
    ///
    /// THE ID COMES FROM WHAT WAS SHARED, so sharing the same reel again lands
    /// on the row you already have instead of growing a second one. A
    /// picture's file name is new for each share, and that is right: two
    /// screenshots are two deliberate saves, even of the same thing.
    ///
    /// A LINK WINS OVER A PICTURE, and a link inside shared text counts:
    /// Instagram sends "Check this out: <url>", not a bare URL.
    static func pendingRows(for shares: [QueuedShare], now: Date) -> [PendingRow] {
        var rows: [PendingRow] = []
        for q in shares {
            let at = iso(date(q.at) ?? now)
            let typed = (q.url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let link = typed.isEmpty ? (q.text?.firstMatch(of: /https?:\/\/\S+/).map { String($0.output) }) : typed
            if let link {
                rows.append(PendingRow(item: pending(id: Store.idFor(link), list: q.list, source: link, at: at), image: nil))
            } else {
                for name in q.images where !name.isEmpty {
                    rows.append(PendingRow(item: pending(id: Store.idFor(name), list: q.list, source: nil, at: at), image: name))
                }
            }
        }
        return rows
    }

    /// Pictures chosen from the camera roll: the same receipt, one row each.
    /// `refs` name the pictures to `read`'s `picture` closure.
    static func pendingRows(forPictures refs: [String], list: String, now: Date) -> [PendingRow] {
        refs.map { PendingRow(item: pending(id: Store.idFor($0), list: list, source: nil, at: iso(now)), image: $0) }
    }

    // MARK: an answer lands on its row

    /// What the resolver said, written onto the row that was waiting for it.
    ///
    ///   items   the FIRST one becomes the row: filed, with your note and your
    ///           pin kept. A reel can hold several things ("5 books I read
    ///           this month"), so the rest become siblings, each with an id
    ///           made from the source and its title — a second read of the
    ///           same reel lands on the same siblings.
    ///   none    read, and nothing in it had a name. The row stays in the pile
    ///           with its link, which is still a thing you saved, and says
    ///           which reader looked.
    ///   error   the row says why, and carries "Read again".
    static func apply(resolved: Result<ResolveResponse, any Error>, to shelf: Shelf, row: PendingRow, now: Date) -> Shelf {
        let stamp = iso(now)
        let got: ResolveResponse
        switch resolved {
        case .failure(let error):
            let why = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return Store.patch(shelf, id: row.item.id) { $0.status = .unread; $0.error = why }
        case .success(let value): got = value
        }
        guard let first = got.items.first else {
            return Store.patch(shelf, id: row.item.id) { $0.status = .unread; $0.resolver = got.resolver; $0.resolvedAt = stamp }
        }
        var cur = Store.patch(shelf, id: row.item.id) { it in
            var next = first
            next.id = it.id
            next.status = .filed
            next.createdAt = it.createdAt
            next.top = it.top
            // What you said about the thing beats what the reel said about it.
            if !it.note.isEmpty { next.note = it.note }
            next.caption = keepCaption(first)
            next.resolvedAt = stamp
            next.error = nil
            next.extra = it.extra.merging(first.extra) { _, new in new }
            it = next
        }
        let source = row.item.sourceURL ?? row.image ?? ""
        for extra in got.items.dropFirst() {
            var sibling = extra
            sibling.id = Store.idFor("\(source)#\(extra.title ?? "null")")
            sibling.status = .filed
            sibling.createdAt = row.item.createdAt
            sibling.resolvedAt = stamp
            cur = Store.upsert(cur, sibling)
            cur = Store.patch(cur, id: sibling.id) { $0.caption = keepCaption(extra) }
        }
        return cur
    }

    // MARK: the slow half

    /// Put the rows on the shelf, SAVE, and only then read each one — saving
    /// after every answer. Twenty screenshots is twenty slow calls; a person
    /// who leaves halfway must come back to twenty rows, not to nothing.
    ///
    /// `picture` hands back the bytes for a row's `image`, or nil when the
    /// file is gone.
    static func read(_ rows: [PendingRow], into shelf: Shelf, api: any Resolving,
                     picture: @Sendable (String) -> Data?, now: @Sendable () -> Date = { Date() },
                     save: @Sendable (Shelf) async -> Void) async -> Shelf {
        guard !rows.isEmpty else { return shelf }
        var cur = shelf
        for row in rows { cur = Store.upsert(cur, row.item) }
        await save(cur)
        for row in rows {
            let result: Result<ResolveResponse, any Error>
            do {
                if let image = row.image {
                    guard let data = picture(image) else { throw PictureError.gone }
                    let upload = try Pictures.base64ForUpload(data: data)
                    result = .success(try await api.resolveImage(base64: upload.base64, mediaType: upload.mediaType, list: row.item.list))
                } else {
                    result = .success(try await api.resolveLink(url: row.item.sourceURL ?? "", list: row.item.list,
                                                                homeCity: cur.profile.homeCity))
                }
            } catch { result = .failure(error) }
            cur = apply(resolved: result, to: cur, row: row, now: now())
            await save(cur)
        }
        return cur
    }

    /// Everything the extension left (`ShareQueue.take()`), onto the shelf and
    /// read. `images` is the folder the extension copied pictures into.
    ///
    /// When it is done every picture has been read, or has failed for a reason
    /// now on its row, so the copies are dead weight and nothing else deletes
    /// them: without this the container grows by a screenshot per share for
    /// ever.
    static func drain(shelf: Shelf, queue: [QueuedShare], api: any Resolving, images: URL? = ShareQueue.images,
                      now: @Sendable () -> Date = { Date() }, save: @Sendable (Shelf) async -> Void) async -> Shelf {
        // The name comes from a file another process wrote: its last part only.
        let file = { @Sendable (name: String) in images?.appendingPathComponent((name as NSString).lastPathComponent) }
        let rows = pendingRows(for: queue, now: now())
        let out = await read(rows, into: shelf, api: api, picture: { name in file(name).flatMap { try? Data(contentsOf: $0) } },
                             now: now, save: save)
        for name in queue.flatMap(\.images) { if let url = file(name) { try? FileManager.default.removeItem(at: url) } }
        return out
    }

    /// Read one shared LINK into the row that is already on the shelf. One
    /// copy, three callers: the "Read again" button, the launch resume and the
    /// foreground resume.
    static func readLink(shelf: Shelf, item: Item, api: any Resolving, now: Date = Date()) async -> Shelf {
        let result: Result<ResolveResponse, any Error>
        do {
            result = .success(try await api.resolveLink(url: item.sourceURL ?? "", list: item.list, homeCity: shelf.profile.homeCity))
        } catch { result = .failure(error) }
        return apply(resolved: result, to: shelf, row: PendingRow(item: item, image: nil), now: now)
    }

    /// "Read again" on an unread row. The row says it is working first, and
    /// that is saved, so the tap shows at once.
    static func retry(shelf: Shelf, item: Item, api: any Resolving, now: @Sendable () -> Date = { Date() },
                      save: @Sendable (Shelf) async -> Void) async -> Shelf {
        guard item.sourceURL != nil else { return shelf }
        let waiting = Store.patch(shelf, id: item.id) { $0.status = .pending; $0.error = nil }
        await save(waiting)
        let done = await readLink(shelf: waiting, item: item, api: api, now: now())
        await save(done)
        return done
    }

    // MARK: resume — nothing may still be "Working it out…" at launch

    /// Can this row be read again? Only a link can. A screenshot's file was in
    /// the App Group container, which is emptied after every drain.
    private static func fromLink(_ item: Item) -> Bool {
        let url = (item.sourceURL ?? "").lowercased()
        return url.hasPrefix("http://") || url.hasPrefix("https://")
    }

    /// A PROCESS THAT HAS JUST STARTED CANNOT BE IN THE MIDDLE OF ANYTHING.
    /// iOS suspends the app the moment you switch away, so a read in flight
    /// just stops: no error, nothing written, and the row says "Working it
    /// out…" for ever. So every pending row seen at launch was interrupted,
    /// and each is either picked up again or given a reason. Never neither.
    ///
    /// `max` bounds the retries: a launch is not the place for thirty network
    /// calls. The rest get the same honest reason and keep "Read again".
    static func resumePlan(_ items: [Item], max: Int = 6) -> ResumePlan {
        let pending = items.filter { $0.status == .pending }
        var plan = ResumePlan(pending: pending, retry: [], giveUp: [])
        for it in pending {
            if fromLink(it) && plan.retry.count < max { plan.retry.append(it) } else { plan.giveUp.append(it) }
        }
        return plan
    }

    /// What a given-up row says: what happened AND what to do. A screenshot
    /// says something else, because for a screenshot there is no way back —
    /// offering to read it again would be a button that fails.
    static func whyStopped(_ item: Item) -> String {
        fromLink(item)
            ? "Reading this was interrupted — tap Read again"
            : "Reading this screenshot was interrupted, and the picture it came from is no longer here. Import it again from your photos."
    }

    /// Run the plan. Call it at launch AND on coming back to the app, after
    /// `drain`. The explanations are written FIRST and saved together: they
    /// need no network, so a row that can never finish stops lying at once
    /// and not after six slow requests.
    static func resumePending(shelf: Shelf, api: any Resolving, max: Int = 6, now: @Sendable () -> Date = { Date() },
                              save: @Sendable (Shelf) async -> Void) async -> Shelf {
        let plan = resumePlan(shelf.items, max: max)
        var cur = shelf
        for it in plan.giveUp { cur = Store.patch(cur, id: it.id) { $0.status = .unread; $0.error = whyStopped(it) } }
        if !plan.giveUp.isEmpty { await save(cur) }
        for it in plan.retry {
            cur = await readLink(shelf: cur, item: it, api: api, now: now())
            await save(cur)
        }
        return cur
    }

    // MARK: the one-time legacy import

    /// Rows of the old server-side store (`API.legacyExport`), as items.
    /// A row somebody threw away stays thrown away.
    static func legacyRows(_ rows: [[String: JSONValue]], now: Date) -> [Item] {
        rows.compactMap { row in
            guard row["status"]?.string != "discarded" else { return nil }
            let id: String
            switch row["id"] {
            case .string(let s)?: id = s
            case .number(let n)?: id = n.rounded() == n ? String(Int64(n)) : String(n)
            default: return nil
            }
            let title = row["title"]?.string
            return Item(
                id: id, list: row["list"]?.string ?? "unsorted", status: (title ?? "").isEmpty ? .unread : .filed,
                title: title, subtitle: row["subtitle"]?.string ?? "", note: row["note"]?.string ?? "",
                imageURL: row["image_url"]?.string, canonical: row["canonical"]?.object ?? [:],
                confidence: row["confidence"]?.number, enriched: row["enriched"]?.bool ?? false,
                sourceURL: row["source_url"]?.string, resolver: row["resolver"]?.string,
                createdAt: row["created_at"]?.string ?? iso(now), resolvedAt: row["resolved_at"]?.string)
        }
    }

    /// ONE TIME, ON AN EMPTY SHELF, FROM THE PHONE APP AND NOTHING ELSE.
    ///
    /// The export is ONE person's old shelf, kept for one phone. The web build
    /// once ran this too, and every new visitor was shown the owner's 21 items
    /// as their own. So: the caller decides whether to ask at all, and never
    /// asks from an extension, a widget or anything that is not the app.
    ///
    /// And a shelf with anything on it is handed back untouched: a shelf you
    /// have curated must never be overwritten by a five-month-old export.
    static func legacyImport(into shelf: Shelf, rows: [[String: JSONValue]], now: Date) -> Shelf {
        guard shelf.items.isEmpty else { return shelf }
        var cur = shelf
        for item in legacyRows(rows, now: now) { cur = Store.upsert(cur, item) }
        // The old store still says "travel". Do not wait for the next launch.
        return Store.migrate(cur)
    }
}
