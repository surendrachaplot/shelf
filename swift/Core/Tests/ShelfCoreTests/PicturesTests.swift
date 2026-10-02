// PicturesTests — a picture made small enough to send, and a picture kept.
// The pictures are drawn here with CoreGraphics; nothing is read from disk.
import XCTest
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import ShelfCore

final class PicturesTests: XCTestCase {
    /// A picture of noise: it does not compress, so its size is honest.
    private func picture(_ width: Int, _ height: Int, as type: UTType = .png, orientation: Int? = nil, thumbnail: Bool = false) throws -> Data {
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { arc4random_buf($0.baseAddress, $0.count) }
        let provider = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        let image = try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                          provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let out = NSMutableData()
        let dest = try XCTUnwrap(CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil))
        var properties: [CFString: Any] = [:]
        if let orientation { properties[kCGImagePropertyOrientation] = orientation }
        if thumbnail { properties[kCGImageDestinationEmbedThumbnail] = true }
        CGImageDestinationAddImage(dest, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw XCTSkip("this Mac cannot write \(type.identifier)") }
        return out as Data
    }

    private func size(_ data: Data) throws -> (type: String, width: Int, height: Int) {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        return (try XCTUnwrap(CGImageSourceGetType(source) as String?),
                try XCTUnwrap(props[kCGImagePropertyPixelWidth] as? Int), try XCTUnwrap(props[kCGImagePropertyPixelHeight] as? Int))
    }

    func testShrinkMakesAJPEGNoLongerThanTheEdge() throws {
        let wide = try size(try XCTUnwrap(Pictures.shrinkJPEG(data: picture(2000, 250), maxEdge: 1600, quality: 0.75)))
        XCTAssertEqual(wide.type, "public.jpeg")
        XCTAssertEqual([wide.width, wide.height], [1600, 200], "the LONG edge is 1600 and the shape is kept")
        let tall = try size(try XCTUnwrap(Pictures.shrinkJPEG(data: picture(300, 1300), maxEdge: 900, quality: 0.7)))
        XCTAssertEqual(tall.height, 900, "a tall screenshot is measured on its height")
        XCTAssertEqual(Double(tall.width), 208, accuracy: 1)
        let small = try size(try XCTUnwrap(Pictures.shrinkJPEG(data: picture(300, 200), maxEdge: 1600, quality: 0.75)))
        XCTAssertEqual([small.width, small.height], [300, 200], "a small picture is never made bigger")
        XCTAssertNil(Pictures.shrinkJPEG(data: Data("not a picture".utf8), maxEdge: 1600, quality: 0.75))
        XCTAssertNil(Pictures.shrinkJPEG(data: Data(), maxEdge: 1600, quality: 0.75))
    }

    func testAPhotoTakenSidewaysIsTurnedTheRightWayUp() throws {
        // Orientation 6: stored on its side, with a tag saying so. A JPEG made from it carries no tag.
        let sideways = try picture(400, 200, as: .jpeg, orientation: 6)
        let out = try size(try XCTUnwrap(Pictures.shrinkJPEG(data: sideways, maxEdge: 1600, quality: 0.75)))
        XCTAssertEqual([out.width, out.height], [200, 400])
    }

    func testAPhotoWithItsOwnThumbnailIsShrunkFromThePhoto() throws {
        // A camera photo carries a tiny preview of itself. Shrinking must start
        // from the photo: the preview is 160 pixels of somebody's screenshot.
        let photo = try picture(2000, 250, as: .jpeg, thumbnail: true)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(photo as CFData, nil))
        let preview = try XCTUnwrap(CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceThumbnailMaxPixelSize: 1600] as CFDictionary))
        XCTAssertLessThan(preview.width, 400, "(the fixture really does carry a preview, and ImageIO hands it over when not told otherwise)")
        let out = try size(try XCTUnwrap(Pictures.shrinkJPEG(data: photo, maxEdge: 1600, quality: 0.75)))
        XCTAssertEqual([out.width, out.height], [1600, 200])
    }

    func testQualityIsUsed() throws {
        let source = try picture(400, 400)
        let low = try XCTUnwrap(Pictures.shrinkJPEG(data: source, maxEdge: 400, quality: 0.2))
        let high = try XCTUnwrap(Pictures.shrinkJPEG(data: source, maxEdge: 400, quality: 0.95))
        XCTAssertLessThan(low.count * 2, high.count, "a lower quality is a smaller file")
    }

    func testTheMediaTypeIsReadFromTheBytes() throws {
        XCTAssertEqual(Pictures.mediaType(of: try picture(8, 8, as: .png)), "image/png")
        XCTAssertEqual(Pictures.mediaType(of: try picture(8, 8, as: .jpeg)), "image/jpeg")
        XCTAssertEqual(Pictures.mediaType(of: try picture(8, 8, as: .gif)), "image/gif")
        XCTAssertEqual(Pictures.mediaType(of: try picture(64, 64, as: .heic)), "image/heic")
        XCTAssertEqual(Pictures.mediaType(of: try picture(8, 8, as: .tiff)), "image/jpeg", "anything else is called JPEG")
        XCTAssertEqual(Pictures.mediaType(of: Data("not a picture".utf8)), "image/jpeg")
    }

    func testTheSendRuleIsTheJavaScripts() {
        XCTAssertEqual(Pictures.sendCeiling, 3_500_000)
        XCTAssertEqual(Pictures.sendEdge, 1600)
        XCTAssertEqual(Pictures.sendQuality, 0.75)
        XCTAssertEqual(Pictures.keepEdge, 900)
        XCTAssertEqual(Pictures.keepQuality, 0.7)
    }

    func testASmallPictureIsSentAsItIs() throws {
        let png = try picture(40, 40)
        let upload = try Pictures.base64ForUpload(data: png)
        XCTAssertEqual(upload, Pictures.Upload(base64: png.base64EncodedString(), mediaType: "image/png"), "the same bytes, under their own name")
        // Exactly at the ceiling is still within it.
        XCTAssertEqual(try Pictures.base64ForUpload(data: png, ceiling: png.base64EncodedString().count).mediaType, "image/png")
    }

    func testAPictureOverTheCeilingIsSentAsASmallerJPEG() throws {
        let png = try picture(2400, 300)
        let was = png.base64EncodedString().count
        let upload = try Pictures.base64ForUpload(data: png, ceiling: was - 1)
        XCTAssertEqual(upload.mediaType, "image/jpeg")
        let sent = try size(try XCTUnwrap(Data(base64Encoded: upload.base64)))
        XCTAssertEqual([sent.width, sent.height], [1600, 200], "at 1600 on the long edge")
        let reference = try XCTUnwrap(Pictures.shrinkJPEG(data: png, maxEdge: 1600, quality: 0.75))
        XCTAssertEqual(upload.base64.count, reference.base64EncodedString().count, "at quality 0.75")
    }

    func testAPictureStillTooLargeIsRefusedWithAReason() throws {
        let png = try picture(400, 400)
        XCTAssertThrowsError(try Pictures.base64ForUpload(data: png, ceiling: 100)) {
            XCTAssertEqual($0 as? PictureError, .tooLarge)
        }
        XCTAssertEqual(PictureError.tooLarge.localizedDescription, "that picture is too large to read — try a screenshot rather than a photo")
        // Bytes that are not a picture and are over the ceiling cannot be shrunk: refused, not posted.
        XCTAssertThrowsError(try Pictures.base64ForUpload(data: Data(repeating: 7, count: 400), ceiling: 100)) {
            XCTAssertEqual($0 as? PictureError, .tooLarge)
        }
    }

    func testHEICIsConvertedWhateverItsSize() throws {
        let heic = try picture(64, 64, as: .heic)
        XCTAssertLessThan(heic.base64EncodedString().count, Pictures.sendCeiling, "(it is small: size is not why it is converted)")
        let upload = try Pictures.base64ForUpload(data: heic)
        XCTAssertEqual(upload.mediaType, "image/jpeg", "the vision API does not take HEIC")
        XCTAssertEqual(try size(try XCTUnwrap(Data(base64Encoded: upload.base64))).type, "public.jpeg")
    }

    func testKeepPictureWritesASmallJPEGBesideTheShelf() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-pictures-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let chosen = try picture(1800, 300)
        let url = try Pictures.keepPicture(data: chosen, id: "i_abc", in: dir)
        XCTAssertEqual(url.path, dir.appendingPathComponent("pictures/i_abc.jpg").path, "<directory>/pictures/<id>.jpg — the folder is made")
        let kept = try size(Data(contentsOf: url))
        XCTAssertEqual(kept.type, "public.jpeg")
        XCTAssertEqual([kept.width, kept.height], [900, 150], "900 on the long edge")
        XCTAssertEqual(try Data(contentsOf: url).count,
                       try XCTUnwrap(Pictures.shrinkJPEG(data: chosen, maxEdge: 900, quality: 0.7)).count, "at quality 0.7")

        XCTAssertThrowsError(try Pictures.keepPicture(data: Data("not a picture".utf8), id: "bad", in: dir)) {
            XCTAssertEqual($0 as? PictureError, .unreadable)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("pictures/bad.jpg").path), "and nothing is written for it")
    }

    func testRebasePictureFollowsTheDocumentsFolder() {
        let docs = URL(string: "file:///var/mobile/Containers/Data/Application/NEW/Documents/")
        let old = "file:///var/mobile/Containers/Data/Application/OLD/Documents/pictures/i_abc.jpg"
        XCTAssertEqual(Pictures.rebasePicture(url: old, documents: docs),
                       "file:///var/mobile/Containers/Data/Application/NEW/Documents/pictures/i_abc.jpg")
        XCTAssertEqual(Pictures.rebasePicture(url: old, documents: URL(string: "file:///new/Documents")),
                       "file:///new/Documents/pictures/i_abc.jpg", "with or without the slash on the folder")
        XCTAssertEqual(Pictures.rebasePicture(url: "file:///a/pictures/b/pictures/c.jpg", documents: docs),
                       "file:///var/mobile/Containers/Data/Application/NEW/Documents/pictures/c.jpg", "the LAST /pictures/ is the folder")
        XCTAssertEqual(Pictures.rebasePicture(url: "https://cdn.example/pictures/x.jpg", documents: docs), "https://cdn.example/pictures/x.jpg",
                       "a picture on the web is not ours to move")
        XCTAssertEqual(Pictures.rebasePicture(url: "file:///somewhere/else/x.jpg", documents: docs), "file:///somewhere/else/x.jpg")
        XCTAssertEqual(Pictures.rebasePicture(url: old, documents: nil), old, "no documents folder, no guess")
        XCTAssertNil(Pictures.rebasePicture(url: nil, documents: docs))
        XCTAssertEqual(Pictures.rebasePicture(url: "", documents: docs), "")
    }
}
