// ShareLogic.swift — the parts of the picker that are arithmetic, not drawing.
//
// Foundation and ImageIO only, and no token is read in here: the values are
// passed in. That is what lets this ONE file also compile into the app's test
// bundle (see `ShelfTests` in project.yml) without dragging the extension in.
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ShareLogic {
    // ── what was shared ──────────────────────────────────────────────────────

    /// Instagram shares a caption with the link inside it. The first http(s)
    /// address is the thing; the same expression ShareBoards.tsx used.
    static func firstURL(in text: String?) -> String? {
        guard let text, let m = text.firstMatch(of: /https?:\/\/\S+/) else { return nil }
        return String(m.output)
    }

    /// A shortcode means nothing to a person. Say what the thing IS.
    static func source(url: String?, text: String?, images: Int) -> String {
        if images == 1 { return "Screenshot" }
        if images > 1 { return "\(images) pictures" }
        if let url {
            if url.contains("instagram.com") { return url.contains("/reel") ? "Instagram reel" : "Instagram post" }
            let host = URL(string: url)?.host() ?? ""
            return host.isEmpty ? "Link" : (host.hasPrefix("www.") ? String(host.dropFirst(4)) : host)
        }
        if !(text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Text" }
        return "Nothing to save"
    }

    // ── type ─────────────────────────────────────────────────────────────────

    struct Caps: Equatable { let size: CGFloat; let lineHeight: CGFloat; let tracking: CGFloat }

    /// `capsType` from app/src/design.js: ONE size for every shelf name, solved
    /// so the longest fits the box. Capped at `max`, floored at `floor`.
    static func capsType(_ labels: [String], boxWidth: CGFloat, max: CGFloat,
                         glyph: CGFloat, tracking: CGFloat, floor: CGFloat) -> Caps {
        let longest = CGFloat(labels.map(\.count).max() ?? 1)
        let fit = boxWidth / (Swift.max(longest, 1) * glyph)
        let size = Swift.max(floor, Swift.min(max, (fit * 2).rounded(.down) / 2))
        return Caps(size: size, lineHeight: (size * 1.05).rounded(.up), tracking: (tracking * size * 100).rounded() / 100)
    }

    // ── colour ───────────────────────────────────────────────────────────────

    /// The board under a tile is the same hue driven toward black. Derived,
    /// so a new shelf cannot arrive without one.
    static func darken(_ hex: UInt32, _ amount: Double = 0.34) -> UInt32 {
        [16, 8, 0].reduce(UInt32(0)) { out, shift in
            out | (UInt32((Double((hex >> shift) & 0xFF) * (1 - amount)).rounded()) << shift)
        }
    }

    // ── pictures ─────────────────────────────────────────────────────────────

    /// Copy a picture into `dir` as a JPEG, 1600px on the long edge at 0.75,
    /// and give back the FILE NAME. A phone original is 12 MB; ten of those
    /// would fill the container the app has to share. ImageIO reads only what
    /// the thumbnail needs, so the original is never decoded at full size.
    /// (The numbers are the ones app/src/screenshots.ts explains.)
    static func storeJPEG(from file: URL, in dir: URL, longEdge: Int = 1600, quality: Double = 0.75) -> String? {
        guard let src = CGImageSourceCreateWithURL(file as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // bake the rotation in
            kCGImageSourceThumbnailMaxPixelSize: longEdge,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let name = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).jpg"
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let out = CGImageDestinationCreateWithURL(dir.appendingPathComponent(name) as CFURL,
                                                        UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(out, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(out) ? name : nil
    }
}
