// ShareQueue.swift — what the share extension leaves for the app.
//
// The extension is a separate process over Instagram (or Safari, or Reddit).
// It must be quick and must not need the network: it writes what was shared
// into the App Group container and closes. The app drains the queue the next
// time it is in front.
//
// One small JSON file per share, named by time, so two shares a second apart
// never write the same file and a half-written one cannot damage another.
// Compiled into BOTH targets — this file is the whole contract between them.
import Foundation

struct QueuedShare: Codable, Equatable, Sendable {
    var url: String?
    var text: String?
    /// File names of pictures copied into the container's `images/` folder.
    var images: [String] = []
    /// The shelf the person tapped, or "unsorted" for "decide for me".
    var list: String
    var at: String
}

enum ShareQueue {
    static let group = "group.com.surendrachaplot.shelf"

    static var root: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("queue", isDirectory: true)
    }
    static var images: URL? { root?.appendingPathComponent("images", isDirectory: true) }

    /// False when the container is not reachable — an unsigned build, or an
    /// entitlement that did not land. The card says so (see Profile).
    static var reachable: Bool { root != nil }

    @discardableResult
    static func push(_ share: QueuedShare) -> Bool {
        guard let root else { return false }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let name = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).json"
            try JSONEncoder().encode(share).write(to: root.appendingPathComponent(name), options: .atomic)
            return true
        } catch { return false }
    }

    /// Everything waiting, oldest first, and REMOVED from the queue: a share
    /// that has been handed to the app is the app's to resolve or to mark
    /// unread, never to be drained twice.
    static func take() -> [QueuedShare] {
        guard let root, let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return [] }
        var out: [QueuedShare] = []
        for name in names.filter({ $0.hasSuffix(".json") }).sorted() {
            let file = root.appendingPathComponent(name)
            if let data = try? Data(contentsOf: file), let s = try? JSONDecoder().decode(QueuedShare.self, from: data) {
                out.append(s)
            }
            try? FileManager.default.removeItem(at: file)
        }
        return out
    }

    static var count: Int {
        guard let root, let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return 0 }
        return names.filter { $0.hasSuffix(".json") }.count
    }
}
