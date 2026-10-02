// Pictures.swift — a picture on this phone, made small enough to send or keep.
//
// A port of app/src/screenshots.ts (the sending half) and app/src/pictures.ts
// (the keeping half). ImageIO does what expo-image-manipulator did, and it is
// on the Mac too, so all of this is tested without a simulator.
//
// WHY THE SCREENSHOT PATH MATTERS MOST. Every other way in goes through a
// scrape of somebody else's site, and scrapes get blocked. A screenshot needs
// nobody's cooperation: the model reads the words off the pixels. When the
// scrape is blocked, this is the app.
import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

/// Why a picture could not be sent or kept. Each is a sentence for a row.
enum PictureError: Error, Equatable, LocalizedError {
    case gone
    case heic
    case tooLarge
    case unreadable

    var errorDescription: String? {
        switch self {
        case .gone: return "that screenshot is no longer on this phone"
        case .heic: return "this phone stores photos in a format the reader can't open (HEIC)"
        case .tooLarge: return "that picture is too large to read — try a screenshot rather than a photo"
        case .unreadable: return "that picture could not be opened"
        }
    }
}

enum Pictures {
    /// THE SIZE PROBLEM. The server refuses a base64 body over 6 MB, and
    /// base64 is 4/3 the size of its bytes. A phone screenshot is a PNG of
    /// 2–4 MB and can pass that outright — and a refused screenshot would look,
    /// on the shelf, just like one the model could not read. So anything near
    /// the ceiling is made a smaller JPEG first.
    static let sendCeiling = 3_500_000   // base64 characters we are happy to post
    /// 1600 on the long edge: screen text reads well below full size, and the
    /// vision API bills by area, so half the edge is a quarter of the cost.
    static let sendEdge = 1600
    /// The usual JPEG knee: the same to the eye for screen text, a fifth of the bytes.
    static let sendQuality = 0.75
    /// A kept picture is a moodboard tile, not an archive.
    static let keepEdge = 900
    static let keepQuality = 0.7

    struct Upload: Equatable, Sendable { var base64: String; var mediaType: String }

    /// A JPEG no longer than `maxEdge` on its long side. Takes HEIC, PNG, JPEG
    /// and anything else ImageIO opens; turns it the right way up; never makes
    /// a small picture bigger. Nil when the bytes are not a picture.
    static func shrinkJPEG(data: Data, maxEdge: Int, quality: Double) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let thumb: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumb as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    /// What the bytes ARE, read from the bytes. (The JavaScript reads the file
    /// name; here there is no name, and the first bytes cannot be wrong about
    /// themselves.) Anything not known is called JPEG, as there.
    static func mediaType(of data: Data) -> String {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let id = CGImageSourceGetType(source) as String?, let type = UTType(id) else { return "image/jpeg" }
        if type.conforms(to: .png) { return "image/png" }
        if type.conforms(to: .gif) { return "image/gif" }
        if type.conforms(to: .webP) { return "image/webp" }
        if type.conforms(to: .heic) || type.conforms(to: .heif) { return "image/heic" }
        return "image/jpeg"
    }

    /// The picture as the resolver will take it: as it is when it is small
    /// enough, a smaller JPEG when it is not.
    ///
    /// HEIC is what an iPhone stores and the vision API does not take it, so
    /// it is converted WHATEVER its size. And a picture still over the ceiling
    /// after shrinking is refused here, with a reason, not posted to be
    /// refused there without one.
    static func base64ForUpload(data: Data, ceiling: Int = sendCeiling) throws -> Upload {
        var upload = Upload(base64: data.base64EncodedString(), mediaType: mediaType(of: data))
        if upload.base64.count > ceiling || upload.mediaType == "image/heic" {
            if let smaller = shrinkJPEG(data: data, maxEdge: sendEdge, quality: sendQuality) {
                upload = Upload(base64: smaller.base64EncodedString(), mediaType: "image/jpeg")
            } else if upload.mediaType == "image/heic" {
                throw PictureError.heic   // nothing gained by posting bytes the API will refuse
            }
        }
        guard upload.base64.count <= ceiling else { throw PictureError.tooLarge }
        return upload
    }

    /// A PICTURE YOU CHOSE, KEPT. The picker hands back a pointer into the
    /// photo library, and that stops working whenever iOS likes. A moodboard
    /// of grey boxes the next morning is worse than no moodboard, so the bytes
    /// are copied to where the shelf itself lives: `<directory>/pictures/<id>.jpg`.
    static func keepPicture(data: Data, id: String, in directory: URL) throws -> URL {
        guard let jpeg = shrinkJPEG(data: data, maxEdge: keepEdge, quality: keepQuality) else { throw PictureError.unreadable }
        let folder = directory.appendingPathComponent("pictures", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let to = folder.appendingPathComponent("\(id).jpg")
        try jpeg.write(to: to, options: .atomic)
        return to
    }

    /// iOS can MOVE the app's container — after a restore, sometimes after an
    /// update — and a path saved last month then points at nothing. The file
    /// is still there, under the NEW documents folder, so the saved path is
    /// pointed at wherever that is today. Anything that is not a file under
    /// `/pictures/` is handed back as it came.
    static func rebasePicture(url: String?, documents: URL?) -> String? {
        guard let url, !url.isEmpty else { return url }
        guard let documents, url.hasPrefix("file:"), let at = url.range(of: "/pictures/", options: .backwards) else { return url }
        let base = documents.absoluteString
        return base + (base.hasSuffix("/") ? "" : "/") + "pictures/" + url[at.upperBound...]
    }
}
