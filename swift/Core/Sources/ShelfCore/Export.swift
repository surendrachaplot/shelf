// Export.swift — your shelf, as two files that need nothing from us to open.
// A port of app/src/export.js, checked against it (golden-export.json): the
// JSON key for key, the page BYTE FOR BYTE.
//
// WHY THIS EXISTS BEFORE ANYBODY IS CHARGED. A shelf that can only be read
// inside the app that made it is a hostage. So there are two ways out:
//
//   Export.json  EVERYTHING, for a machine. Every item as it is held, so
//                another program (or this one, later) can take it back.
//   Export.html  EVERYTHING A PERSON WOULD READ, for a person. One file, no
//                script, no network needed. An article saved with its text is
//                still there after the link has died.
//
// TWO RULES:
//
// 1. EVERY STRING ON THE PAGE IS SOMEBODY ELSE'S. Titles come from catalogues,
//    captions from strangers, notes from the person. All of it goes through
//    `esc`, and a URL reaches an href or a src only if it is http(s). The file
//    is opened from disk, where a script would run with file:// reach.
// 2. THE TIME IS AN ARGUMENT. `now` is passed in, never read here, so the
//    same shelf and the same `now` give the same bytes.
import Foundation

enum Export {
    static let format = "shelf-export"
    static let version = 1

    enum Kind: String, Sendable { case json, html }

    private typealias C = DesignConstants
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static func pad(_ n: Int) -> String { n < 10 && n >= 0 ? "0\(n)" : "\(n)" }

    /// "1 Oct 2026", in the person's own time zone.
    private static func day(_ ms: Double?, _ tz: TimeZone) -> String? {
        guard let ms else { return nil }
        let d = JSCompat.local(ms, tz)
        return "\(d.day) \(months[d.month - 1]) \(d.year)"
    }

    /// The five characters that can end an attribute or start a tag.
    static func esc(_ s: String?) -> String {
        var out = ""
        for ch in (s ?? "").unicodeScalars {
            switch ch {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            case "'": out += "&#39;"
            default: out.unicodeScalars.append(ch)
            }
        }
        return out
    }

    /// http(s) or nothing. `javascript:`, `data:`, `file:` and `geo:` all get
    /// nothing, and so does a URL with a space in it.
    private static func http(_ u: String?) -> String? {
        guard let u else { return nil }
        let t = Array(JSCompat.trim(Array(u.utf16)[...]))
        let lower = t.prefix(8).map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 }
        let scheme = [Array("https://".utf16), Array("http://".utf16)].first { lower.starts(with: $0) }
        guard let scheme, t.count > scheme.count, !t.contains(where: JSCompat.isSpace) else { return nil }
        return JSCompat.string(t)
    }

    /// `shelf-2026-10-01.json`. The LOCAL date: it is the day the person did it.
    static func filename(_ kind: Kind, now: Date?, timeZone: TimeZone = .current) -> String {
        guard let now else { return "shelf.\(kind.rawValue)" }
        let d = JSCompat.local(JSCompat.ms(now), timeZone)
        return "shelf-\(d.year)-\(pad(d.month))-\(pad(d.day)).\(kind.rawValue)"
    }

    // ── the file for a machine ───────────────────────────────────────────────

    private struct File: Encodable {
        struct List: Encodable {
            let board: Board
            enum Key: String, CodingKey { case id, name, pins, query, view, created_at }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: Key.self)
                try c.encode(board.id, forKey: .id)
                try c.encode(board.name, forKey: .name)
                try c.encode(board.pins, forKey: .pins)
                // `query: null` is written, not left out: the Expo app writes
                // the key on every list, and a reader may expect it.
                try c.encode(board.query, forKey: .query)
                try c.encode(board.view, forKey: .view)
                try c.encode(board.createdAt, forKey: .created_at)
            }
        }
        /// THE FIELDS ARE NAMED, NOT COPIED. See `json`.
        struct Link: Encodable {
            let link: PublishedLink
            enum Key: String, CodingKey { case kind, target, title, at }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: Key.self)
                try c.encode(link.kind, forKey: .kind)
                try c.encode(link.target, forKey: .target)
                try c.encode(link.title, forKey: .title)
                try c.encode(link.at, forKey: .at)
            }
        }
        let shelf: Shelf
        let exportedAt: String?
        enum Key: String, CodingKey { case format, version, exported_at, profile, items, lists, links }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Key.self)
            try c.encode(Export.format, forKey: .format)
            try c.encode(Export.version, forKey: .version)
            try c.encode(exportedAt, forKey: .exported_at)
            try c.encode(shelf.profile, forKey: .profile)
            try c.encode(shelf.items, forKey: .items)
            try c.encode(shelf.boards.map(List.init), forKey: .lists)
            try c.encode(shelf.links.map(Link.init), forKey: .links)
        }
    }

    /// The whole shelf, for a machine.
    ///
    /// Items go out WHOLE — every field, including ones added after this was
    /// written (`canonical.article`, `canonical.ocr_text`, whatever comes
    /// next; the model keeps keys it does not know). Picking fields here would
    /// be a list that is wrong the next time an item learns something.
    ///
    /// LINKS LOSE THEIR `code`. A link is { code, kind, target, title, at },
    /// and `code` is not just the address of the public page: `POST
    /// /api/publish/revoke` takes the code and nothing else, so it is also the
    /// only key that deletes the page. An export gets emailed, dropped in a
    /// shared folder, handed to another app. So what goes out is the record
    /// that a link was made — what, and when — and never the thing that can
    /// act on it. The phone still holds the codes; nothing is lost.
    ///
    /// Your own lists go out as `lists` (they are `boards` in the file on the
    /// phone, because `list` on an item already means its shelf).
    ///
    /// A missing `now` writes `exported_at: null` rather than failing: a
    /// forgotten argument must not be what stops somebody leaving.
    ///
    /// Pretty-printed with sorted keys: a person can read it, a diff can show
    /// it, and the same shelf gives the same bytes.
    static func json(_ shelf: Shelf, now: Date?) -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try? enc.encode(File(shelf: shelf, exportedAt: now.map(isoString)))
        // Encoding strings, numbers and arrays of them does not fail.
        return String(decoding: data ?? Data("{}".utf8), as: UTF8.self)
    }

    /// `Date#toISOString`: UTC, always three decimals, always `Z`.
    static func isoString(_ date: Date) -> String {
        let ms = JSCompat.ms(date)
        let days = (ms / JSCompat.dayMs).rounded(.down)
        let rest = Int(ms - days * JSCompat.dayMs)
        let (y, m, d) = JSCompat.civil(fromDays: Int(days))
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", y, m, d, rest / 3_600_000, rest / 60000 % 60, rest / 1000 % 60, rest % 1000)
    }

    // ── the page for a person ────────────────────────────────────────────────

    // `unsorted` is a state and not a shelf, so it has no name to capitalise.
    private static func labelOf(_ k: String) -> String { k == "unsorted" ? "Not shelved" : k.prefix(1).uppercased() + k.dropFirst() }
    private static func listOf(_ item: Item) -> String { C.listKeys.contains(item.list) ? item.list : "unsorted" }

    /// `canonical.article` is the saved text, or an object carrying it as `.text`.
    private static func article(_ c: [String: JSONValue]) -> (text: String, by: String)? {
        let a = c["article"]
        let text = JSCompat.trim(a?.string ?? a?["text"]?.string ?? "")
        if text.isEmpty { return nil }
        let by = a?.object == nil ? "" : [a?["byline"], a?["siteName"]].filter { JSCompat.truthy($0) }.map { JSCompat.string($0) }.joined(separator: " · ")
        return (text, by)
    }

    private static func stylesheet() -> String {
        let n = JSCompat.number
        func vars(_ p: [String: String]) -> String {
            "--paper:\(p["bg"]!); --sunk:\(p["surfaceSunk"]!); --ink:\(p["ink"]!); --soft:\(p["inkSoft"]!); --faint:\(p["inkFaint"]!); --line:\(p["line"]!);"
        }
        func step(_ s: C.Step) -> String { "font-size:\(n(s.fontSize))px;line-height:\(n(s.lineHeight))px;font-weight:\(s.fontWeight)" }
        // A shelf's field and its label, per scheme. Most are the same in
        // both; Notes is paper with ink on it, and both of those invert.
        func shelves(_ p: [String: String]) -> String {
            C.listKeys.map { "--\($0):\(p[$0]!); --on-\($0):\(DesignMath.onFor($0, p));" }.joined(separator: " ")
        }
        let sp = C.Space.self
        return """

        :root{ \(vars(C.light))
          \(shelves(C.light)) }
        /* Only the structure colour inverts. The shelf colours are the brand and are
           the same in both schemes, as in the app — except Notes, which is paper. */
        @media (prefers-color-scheme: dark){ :root{ \(vars(C.dark)) \(shelves(C.dark)) } }
        *{margin:0;padding:0;box-sizing:border-box;border-radius:0}
        body{background:var(--paper);color:var(--ink);font-family:Helvetica,Arial,sans-serif;\(step(C.body))}
        .wrap{max-width:760px;margin:0 auto;padding:0 \(n(sp.lg))px \(n(sp.huge))px}
        a{color:inherit}
        .head{padding:\(n(sp.xl))px 0 \(n(sp.md))px}
        .wordmark{font-size:42px;line-height:44px;letter-spacing:-2.6px;font-weight:700}
        .rule{height:\(n(C.rule))px;background:var(--ink)}
        .who{padding:\(n(sp.lg))px 0}
        .name{\(step(C.title));letter-spacing:-1px}
        .micro{\(step(C.micro));letter-spacing:1.8px;text-transform:uppercase}
        .meta{\(step(C.meta));color:var(--soft)}
        .faint{color:var(--faint)}
        .band{display:flex;align-items:center;gap:\(n(sp.md))px;padding:\(n(sp.md))px \(n(sp.lg))px;margin:\(n(sp.xl))px -\(n(sp.lg))px 0;border-bottom:\(n(C.board))px solid var(--ink)}
        .band h2{font-size:31px;line-height:31px;letter-spacing:-1.5px;font-weight:700;text-transform:uppercase;flex:1}
        .item{display:flex;gap:\(n(sp.lg))px;align-items:flex-start;padding:\(n(sp.lg))px 0;border-bottom:\(n(C.hairline))px solid var(--line)}
        /* min-height is for the day the cover is gone: a broken image with no height
           collapses to a black bar, and with one it is a box that shows its alt text. */
        .item img{flex:none;width:\(n(C.coverMinW))px;min-height:\(n(C.coverMinW))px;object-fit:cover;border:\(n(C.coverKeyline))px solid var(--ink);background:var(--sunk);color:var(--soft);\(step(C.micro))}
        .what{flex:1;min-width:0;overflow-wrap:anywhere}
        .what > * + *{margin-top:\(n(sp.sm))px}
        h3{\(step(C.heading));letter-spacing:\(n(C.heading.letterSpacing))px}
        .lede{color:var(--soft);max-width:60ch}
        dl{display:grid;grid-template-columns:max-content 1fr;gap:\(n(sp.xs))px \(n(sp.md))px}
        dt{color:var(--faint)}
        .note{border:\(n(C.coverKeyline))px solid var(--ink);padding:\(n(sp.md))px;white-space:pre-wrap;max-width:60ch}
        .text{background:var(--sunk);padding:\(n(sp.md))px;white-space:pre-wrap;max-width:68ch}
        .colophon{margin-top:\(n(sp.huge))px;border-top:\(n(C.rule))px solid var(--ink);padding-top:\(n(sp.md))px}
        @media (max-width:400px){ .item{flex-direction:column} }
        @media print{ .band{break-after:avoid} .item{break-inside:avoid} }

        """
    }

    private static func itemHtml(_ item: Item, _ f: Facts.Result, _ tz: TimeZone) -> String {
        let title = esc((item.title ?? "").isEmpty ? "Untitled" : item.title)
        let article = article(item.canonical)
        let img = http(item.imageURL)
        let source = http(item.sourceURL)

        var foot: [String] = []
        if let saved = day(JSCompat.parseDate(item.createdAt, tz), tz) { foot.append("Saved \(esc(saved))") }
        // A row that was never resolved is still somebody's save. Say what it is.
        if item.status != .filed { foot.append("Not read yet") }
        for l in f.links {
            if let url = http(l.url) {
                foot.append("<a href=\"\(esc(url))\" rel=\"nofollow noopener\">\(esc(l.label))</a>")
            } else if l.url.utf16.prefix(4).elementsEqual("tel:".utf16, by: { ((0x41...0x5A).contains($0) ? $0 + 0x20 : $0) == $1 }) {
                // A phone number is worth keeping and `tel:` is not http: print it.
                foot.append("\(esc(l.label)) \(esc(JSCompat.string(l.url.utf16.dropFirst(4))))")
            }
        }
        if let source { foot.append("<a href=\"\(esc(source))\" rel=\"nofollow noopener\">Where this came from</a>") }

        let note = JSCompat.trim(item.note)
        let rows = f.rows.map { "<dt>\(esc($0.label))</dt><dd>\(esc($0.value))</dd>" }.joined()
        // One line per part, and an EMPTY line where a part is missing: the
        // template in export.js does exactly that, and the page is compared
        // with it byte for byte.
        return [
            "<article class=\"item\">",
            img.map { "<img src=\"\(esc($0))\" alt=\"\(title)\" loading=\"lazy\" referrerpolicy=\"no-referrer\">" } ?? "",
            "<div class=\"what\">",
            "<h3>\(title)</h3>",
            item.subtitle.isEmpty ? "" : "<p class=\"meta\">\(esc(item.subtitle))</p>",
            (f.lede ?? "").isEmpty ? "" : "<p class=\"lede\">\(esc(f.lede))</p>",
            f.rows.isEmpty ? "" : "<dl>\(rows)</dl>",
            note.isEmpty ? "" : "<p class=\"note\">\(esc(note))</p>",
            article.map { "<p class=\"micro faint\">Saved text\($0.by.isEmpty ? "" : " · \(esc($0.by))")</p><div class=\"text\">\(esc($0.text))</div>" } ?? "",
            foot.isEmpty ? "" : "<p class=\"meta\">\(foot.joined(separator: " · "))</p>",
            "</div>",
            "</article>",
        ].joined(separator: "\n")
    }

    /// The whole shelf, for a person. One file: inline CSS, no script, no font
    /// or stylesheet fetched. A cover is the one remote thing, and it carries
    /// the title as its alt text, so when the image host is gone the row still
    /// says what it is.
    ///
    /// Shelves come out in shelf order and only when they hold something — an
    /// archive is not the place for six empty headings. An item on a shelf
    /// that does not exist is printed under "Not shelved".
    ///
    /// `facts` is what the catalogue knows about an item. The default is the
    /// one to use: `Facts.for` with NO platform, so a map link is the https
    /// one, which opens on anything (a `geo:` link in a browser is dead). It is
    /// an argument only so this page can be checked apart from Facts.
    static func html(_ shelf: Shelf, now: Date?, timeZone: TimeZone = .current,
                     facts: (Item) -> Facts.Result = { Facts.for($0, platform: nil) }) -> String {
        let items = shelf.items
        let profile = shelf.profile
        let when = day(now.map(JSCompat.ms), timeZone)
        let title = "\(profile.name.isEmpty ? "" : "\(profile.name) · ")shelf\(when.map { " · \($0)" } ?? "")"

        let sections = C.listKeys.compactMap { k -> String? in
            let mine = items.filter { listOf($0) == k }
            if mine.isEmpty { return nil }
            return """
            <section>
            <div class="band" style="background:var(--\(k));color:var(--on-\(k))"><h2>\(esc(labelOf(k)))</h2><span class="micro">\(pad(mine.count))</span></div>
            \(mine.map { itemHtml($0, facts($0), timeZone) }.joined(separator: "\n"))
            </section>
            """
        }.joined(separator: "\n")

        return """
        <!doctype html><html lang="en"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="color-scheme" content="light dark">
        <title>\(esc(title))</title>
        <style>\(stylesheet())</style>
        </head><body><div class="wrap">
        <div class="head"><div class="wordmark">shelf</div></div>
        <div class="rule"></div>
        <div class="who">
        \(profile.name.isEmpty ? "" : "<h1 class=\"name\">\(esc(profile.name))</h1>")
        \(profile.bio.isEmpty ? "" : "<p class=\"meta\">\(esc(profile.bio))</p>")
        <p class="micro faint">\(items.count) \(items.count == 1 ? "thing" : "things")\(when.map { " · exported \(esc($0))" } ?? "")</p>
        </div>
        \(sections.isEmpty ? "<p class=\"meta\">Nothing on this shelf yet.</p>" : sections)
        <p class="colophon meta">This file is yours. It needs no app and no network to read. The covers are fetched from where they were found, so a cover can go missing. The words cannot.</p>
        </div></body></html>
        """
    }
}
