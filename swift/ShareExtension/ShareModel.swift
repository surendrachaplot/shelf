// ShareModel.swift — what was shared, and the one write that keeps it.
//
// NO NETWORK IN HERE. This sheet is on top of Instagram and has one job:
// record what was tapped and get out of the way. It writes ONE `QueuedShare`
// to the App Group container; the app resolves it later.
import Foundation
import UniformTypeIdentifiers

@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable { case idle, saving(String), done(String), failed(String) }

    static let maxImages = 10
    static let noContainer = "shelf cannot keep this yet. Open shelf once, then share again."
    static let nothing = "There is nothing here that shelf can save."

    @Published private(set) var url: String?
    @Published private(set) var text: String?
    /// File names in the container, by the order they were shared in — the
    /// pictures finish loading in any order.
    @Published private(set) var images: [Int: String] = [:]
    @Published private(set) var pending = 0
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var reachable = true

    /// Called once: true when the share was kept, false when the sheet is closed without one.
    var onClose: (Bool) -> Void = { _ in }
    private var kept = false

    var sharedURL: String? { url ?? ShareLogic.firstURL(in: text) }
    private var cleanText: String? {
        let t = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    var canSave: Bool { reachable && (sharedURL != nil || !images.isEmpty || cleanText != nil) }
    var source: String { ShareLogic.source(url: sharedURL, text: text, images: images.count) }
    /// The one sentence shown instead of the tiles when nothing can be saved.
    var blocker: String? {
        if !reachable { return Self.noContainer }
        return pending == 0 && !canSave ? Self.nothing : nil
    }
    var saving: String? { if case .saving(let l) = phase { l } else { nil } }

    // ── input ────────────────────────────────────────────────────────────────

    func load(_ items: [NSExtensionItem]) {
        // An unsigned build, or an entitlement that did not land: nothing
        // written here would ever reach the app, so say that and stop.
        guard let dir = ShareQueue.images else { reachable = false; return }
        var slot = 0
        for item in items {
            if text == nil, let t = item.attributedContentText?.string, !t.isEmpty { text = t }
            for p in item.attachments ?? [] {
                if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    guard slot < Self.maxImages else { continue }
                    let i = slot; slot += 1; pending += 1
                    // The file exists only inside this callback, which runs
                    // off the main thread — so the copy is made right here.
                    _ = p.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { file, _ in
                        let name = file.flatMap { ShareLogic.storeJPEG(from: $0, in: dir) }
                        Task { @MainActor in self.arrived { if let name { self.images[i] = name } } }
                    }
                } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    pending += 1
                    _ = p.loadObject(ofClass: URL.self) { u, _ in
                        let s = u.flatMap { $0.isFileURL ? nil : $0.absoluteString }
                        Task { @MainActor in self.arrived { if self.url == nil { self.url = s } } }
                    }
                } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    pending += 1
                    _ = p.loadObject(ofClass: String.self) { s, _ in
                        Task { @MainActor in self.arrived { if let s, !s.isEmpty { self.text = s } } }
                    }
                }
            }
        }
    }

    private func arrived(_ apply: () -> Void) {
        apply()
        pending -= 1
        // A tile tapped while pictures were still being copied waits for the
        // last one, so "3 pictures" is never saved as one.
        if pending == 0, let list = saving { commit(list) }
    }

    // ── the write ────────────────────────────────────────────────────────────

    func save(_ list: String) {
        guard canSave, saving == nil, !kept else { return }
        phase = .saving(list)
        if pending == 0 { commit(list) }
    }

    private func commit(_ list: String) {
        let share = QueuedShare(url: sharedURL, text: cleanText,
                                images: images.sorted { $0.key < $1.key }.map(\.value),
                                list: list, at: ISO8601DateFormatter().string(from: Date()))
        Task.detached(priority: .userInitiated) {
            let ok = ShareQueue.push(share)
            await self.pushed(ok, list)
        }
    }

    private func pushed(_ ok: Bool, _ list: String) {
        // A failed write is the one thing this sheet must never call a save.
        guard ok else { phase = .failed("Could not save. Open shelf once, then try again."); return }
        kept = true
        phase = .done(list)
        Task {
            // Long enough to read the colour, short enough that nobody waits.
            try? await Task.sleep(for: .milliseconds(420))
            onClose(true)
        }
    }

    func close() { onClose(false) }

    /// Closed without a save: the pictures already copied belong to nobody.
    func discard() {
        guard !kept, let dir = ShareQueue.images else { return }
        let names = Array(images.values)
        images = [:]
        Task.detached { for n in names { try? FileManager.default.removeItem(at: dir.appendingPathComponent(n)) } }
    }
}

#if DEBUG
extension ShareModel {
    /// For the #Preview and a snapshot host: there is no extension context, so
    /// pretend something was shared. `done` jumps to the confirmation.
    func demo(_ kind: String = "reel", done: String? = nil) {
        switch kind {
        case "none": break
        case "text": text = "A line somebody wrote down."
        case "link": url = "https://www.example.com/a-page"
        case "pictures": images = [0: "a.jpg", 1: "b.jpg", 2: "c.jpg"]
        case "screenshot": images = [0: "a.jpg"]
        default: text = "Look at this https://www.instagram.com/reel/C0ffee/"
        }
        if let done { phase = .done(done) }
    }
}
#endif
