// ShareLogicTests.swift — the picker's arithmetic. ShareLogic.swift is
// compiled INTO this bundle (project.yml), so nothing here needs the extension.
import XCTest
import ImageIO
import UniformTypeIdentifiers
@testable import shelf

final class ShareLogicTests: XCTestCase {
    func testWhatWasSharedIsNamedForAPerson() {
        let reel = ShareLogic.firstURL(in: "Look at this https://www.instagram.com/reel/C0ffee/ wow")
        XCTAssertEqual(reel, "https://www.instagram.com/reel/C0ffee/")
        XCTAssertNil(ShareLogic.firstURL(in: "no address here"))
        XCTAssertNil(ShareLogic.firstURL(in: nil))

        XCTAssertEqual(ShareLogic.source(url: reel, text: nil, images: 0), "Instagram reel")
        XCTAssertEqual(ShareLogic.source(url: "https://www.instagram.com/p/abc/", text: nil, images: 0), "Instagram post")
        XCTAssertEqual(ShareLogic.source(url: "https://www.youtube.com/watch?v=1", text: nil, images: 0), "youtube.com")
        XCTAssertEqual(ShareLogic.source(url: "https://", text: nil, images: 0), "Link")
        XCTAssertEqual(ShareLogic.source(url: nil, text: nil, images: 1), "Screenshot")
        XCTAssertEqual(ShareLogic.source(url: nil, text: nil, images: 3), "3 pictures")
        XCTAssertEqual(ShareLogic.source(url: nil, text: "a line", images: 0), "Text")
        XCTAssertEqual(ShareLogic.source(url: nil, text: "  \n", images: 0), "Nothing to save")
    }

    /// The same answers design.js `capsType` gives: 19.5 at 375pt, 16 at 320pt.
    func testOneCapsSizeFitsTheLongestShelfName() {
        let labels = Lists.shelves.map(\.label)
        func caps(_ sheet: CGFloat) -> ShareLogic.Caps {
            ShareLogic.capsType(labels, boxWidth: sheet / 2 - Tokens.Space.lg * 2, max: T.band.resolvedSize,
                                glyph: Tokens.Cover.capsGlyph, tracking: Tokens.Cover.capsTracking, floor: Tokens.Text.floor)
        }
        XCTAssertEqual(caps(375), ShareLogic.Caps(size: 19.5, lineHeight: 21, tracking: -0.94))
        XCTAssertEqual(caps(320), ShareLogic.Caps(size: 16, lineHeight: 17, tracking: -0.77))
        XCTAssertEqual(caps(2000).size, T.band.resolvedSize)
        XCTAssertEqual(caps(80).size, Tokens.Text.floor)

        // And it is TRUE on the glass: the longest name, set in the real face,
        // is inside the tile's box at the narrow phone.
        let c = caps(320)
        let font = UIFont(name: "HelveticaNeue-Bold", size: c.size)!
        let longest = labels.map { ($0.uppercased() as NSString).size(withAttributes: [.font: font, .kern: c.tracking]).width }.max()!
        XCTAssertLessThanOrEqual(longest, 320 / 2 - Tokens.Space.lg * 2)
    }

    func testTheBoardIsTheFieldDrivenDark() {
        XCTAssertEqual(ShareLogic.darken(0x0B3EE3), 0x072996)   // what darken() in ShareBoards.tsx gives for books
        XCTAssertEqual(ShareLogic.darken(0xFFD400), 0xA88C00)
        XCTAssertEqual(ShareLogic.darken(0x000000), 0x000000)
    }

    func testAPictureIsStoredSmallAsAJPEG() throws {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        // A 3000 x 2000 original.
        let original = tmp.appendingPathComponent("original.png")
        let ctx = CGContext(data: nil, width: 3000, height: 2000, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.setFillColor(red: 0.9, green: 0.1, blue: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: 3000, height: 2000))
        let dest = CGImageDestinationCreateWithURL(original as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
        XCTAssertTrue(CGImageDestinationFinalize(dest))

        let dir = tmp.appendingPathComponent("images")   // does not exist yet: storeJPEG makes it
        let name = try XCTUnwrap(ShareLogic.storeJPEG(from: original, in: dir))
        XCTAssertTrue(name.hasSuffix(".jpg"))
        XCTAssertNotEqual(name, ShareLogic.storeJPEG(from: original, in: dir))   // unique names

        let src = try XCTUnwrap(CGImageSourceCreateWithURL(dir.appendingPathComponent(name) as CFURL, nil))
        XCTAssertEqual(CGImageSourceGetType(src) as String?, UTType.jpeg.identifier)
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
        XCTAssertEqual(props?[kCGImagePropertyPixelWidth] as? Int, 1600)
        XCTAssertEqual(props?[kCGImagePropertyPixelHeight] as? Int, 1067)

        XCTAssertNil(ShareLogic.storeJPEG(from: tmp.appendingPathComponent("missing.png"), in: dir))
    }
}
