// DesignMathTests — DesignMath.swift against the real design.js.
//
// Every case in golden-design.json is an input and what app/src/design.js
// answered for it (tools/golden/design.mjs writes the file). The port must
// answer the same. Floats are compared to 1e-9 and never rounded first: a
// rounded comparison is how "Rosewoo / d" gets through.
import XCTest
@testable import ShelfCore

/// One node of a golden file. Shared by the four golden test files here.
struct GoldenNode {
    let raw: Any

    /// `SHELF_GOLDEN_DIR` points the tests at another folder of golden files.
    /// It exists for one thing: proving the harness is alive, by running it
    /// against a copy with one expected value changed and watching it fail.
    static func load(_ name: String) throws -> GoldenNode {
        let url: URL
        if let dir = ProcessInfo.processInfo.environment["SHELF_GOLDEN_DIR"] {
            url = URL(fileURLWithPath: dir).appendingPathComponent(name + ".json")
        } else {
            url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"), "\(name).json is not in Fixtures")
        }
        return GoldenNode(raw: try JSONSerialization.jsonObject(with: Data(contentsOf: url)))
    }

    subscript(key: String) -> GoldenNode { GoldenNode(raw: (raw as? [String: Any])?[key] ?? NSNull()) }
    var isNull: Bool { raw is NSNull }
    var list: [GoldenNode] { (raw as? [Any] ?? []).map(GoldenNode.init) }
    var d: Double { (raw as? NSNumber)?.doubleValue ?? .nan }
    var i: Int { (raw as? NSNumber)?.intValue ?? Int.min }
    var b: Bool { (raw as? NSNumber)?.boolValue ?? false }
    var s: String { raw as? String ?? "<not a string>" }
    var strings: [String] { list.map(\.s) }
    var zone: TimeZone { TimeZone(identifier: s) ?? TimeZone(secondsFromGMT: 0)! }
    var date: Date { Date(timeIntervalSince1970: d / 1000) }

    /// The cases of one block. A block that is missing or empty FAILS: a
    /// harness that reads nothing passes everything.
    func cases(_ block: String, atLeast n: Int, file: StaticString = #filePath, line: UInt = #line) -> [GoldenNode] {
        let all = self[block].list
        XCTAssertGreaterThanOrEqual(all.count, n, "golden block \(block) has too few cases", file: file, line: line)
        return all
    }

    func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed]))
    }
}

final class DesignMathTests: XCTestCase {
    private func near(_ got: Double, _ want: Double, _ what: @autoclosure () -> String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(got, want, accuracy: 1e-9, what(), file: file, line: line)
    }

    private let palettes = ["light": DesignConstants.light, "dark": DesignConstants.dark]

    // ── the generated constants ──────────────────────────────────────────────

    func testTheCommittedConstantsFileIsWhatTheGeneratorWrites() throws {
        let g = try GoldenNode.load("golden-design")
        let core = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let committed = try String(contentsOf: core.appendingPathComponent("Sources/ShelfCore/DesignConstants.swift"), encoding: .utf8)
        XCTAssertEqual(committed, g["constants_swift"].s, "DesignConstants.swift is stale or hand-edited: run node swift/tools/golden/design.mjs")
    }

    func testTheConstantsHaveTheValuesDesignJsHas() throws {
        let c = try GoldenNode.load("golden-design")["constants"]
        typealias D = DesignConstants
        XCTAssertEqual(D.typeFloor, c["typeFloor"].d)
        let steps = try XCTUnwrap(c["type"].raw as? [String: Any])
        XCTAssertEqual(Set(steps.keys), Set(D.type.keys))
        for (name, step) in D.type {
            let want = c["type"][name]
            XCTAssertEqual(step, D.Step(fontSize: want["fontSize"].d, lineHeight: want["lineHeight"].d, letterSpacing: want["letterSpacing"].d, fontWeight: want["fontWeight"].s), name)
        }
        XCTAssertEqual(D.sp, c["sp"].raw as? [String: Double])
        XCTAssertEqual([D.Space.xs, D.Space.sm, D.Space.md, D.Space.lg, D.Space.xl, D.Space.xxl, D.Space.huge],
                       ["xs", "sm", "md", "lg", "xl", "xxl", "huge"].map { c["sp"][$0].d })
        let scalars: [(String, Double)] = [
            ("board", D.board), ("rule", D.rule), ("hairline", D.hairline), ("coverKeyline", D.coverKeyline),
            ("coverMinW", D.coverMinW), ("coverComps", Double(D.coverComps)), ("coverPad", D.coverPad),
            ("emptyBoardH", D.emptyBoardH), ("maxEmptyBoards", Double(D.maxEmptyBoards)),
            ("jacketGlyph", D.jacketGlyph), ("capsGlyph", D.capsGlyph), ("capsTracking", D.capsTracking),
            ("quoteGlyph", D.quoteGlyph), ("quoteLeading", D.quoteLeading), ("placeholderMix", D.placeholderMix),
            ("staggerStep", D.staggerStep), ("staggerMaxSteps", Double(D.staggerMaxSteps)),
        ]
        for (name, value) in scalars { XCTAssertEqual(value, c[name].d, name) }
        XCTAssertEqual(D.coverHeights, c["coverHeights"].list.map(\.d))
        XCTAssertEqual(D.listKeys, c["listKeys"].strings)
        XCTAssertEqual(D.listOn, c["listOn"].raw as? [String: String])
        XCTAssertEqual(D.light, c["light"].raw as? [String: String])
        XCTAssertEqual(D.dark, c["dark"].raw as? [String: String])
    }

    // ── covers and the bookcase ──────────────────────────────────────────────

    func testCoverFor() throws {
        for c in try GoldenNode.load("golden-design").cases("coverFor", atLeast: 60) {
            let got = DesignMath.coverFor(c["input"]["title"].s)
            XCTAssertEqual(got, .init(height: c["output"]["height"].d, comp: c["output"]["comp"].i), "coverFor(\(c["input"]["title"].s.debugDescription))")
        }
    }

    func testGridFor() throws {
        for c in try GoldenNode.load("golden-design").cases("gridFor", atLeast: 80) {
            let (i, o) = (c["input"], c["output"])
            let got = DesignMath.gridFor(available: i["available"].d, gap: i["gap"].d)
            XCTAssertEqual(got.cols, o["cols"].i, "gridFor \(i.raw)")
            near(got.width, o["width"].d, "gridFor \(i.raw)")
        }
    }

    func testRowsOf() throws {
        for c in try GoldenNode.load("golden-design").cases("rowsOf", atLeast: 40) {
            XCTAssertEqual(DesignMath.rowsOf(c["input"]["n"].i, cols: c["input"]["cols"].i), c["output"].list.map { $0.list.map(\.i) }, "rowsOf \(c["input"].raw)")
        }
    }

    func testEmptyBoardsAndThePitches() throws {
        let g = try GoldenNode.load("golden-design")
        for c in g.cases("emptyBoards", atLeast: 200) {
            let i = c["input"]
            XCTAssertEqual(DesignMath.emptyBoards(viewportH: i["viewportH"].d, usedH: i["usedH"].d, pitch: i["pitch"].d), c["output"].i, "emptyBoards \(i.raw)")
        }
        for c in g.cases("rowPitch", atLeast: 6) { near(DesignMath.rowPitch(gapAbove: c["input"]["gapAbove"].d), c["output"].d, "rowPitch \(c["input"].raw)") }
        for c in g.cases("emptyPitch", atLeast: 6) { near(DesignMath.emptyPitch(gapAbove: c["input"]["gapAbove"].d), c["output"].d, "emptyPitch \(c["input"].raw)") }
    }

    // ── what is written on a jacket ──────────────────────────────────────────

    func testMainTitle() throws {
        for c in try GoldenNode.load("golden-design").cases("mainTitle", atLeast: 60) {
            XCTAssertEqual(DesignMath.mainTitle(c["input"]["title"].s), c["output"].s, "mainTitle(\(c["input"]["title"].s.debugDescription))")
        }
    }

    func testJacketType() throws {
        for c in try GoldenNode.load("golden-design").cases("jacketType", atLeast: 1000) {
            let (i, o) = (c["input"], c["output"])
            let got = DesignMath.jacketType(i["title"].s, coverWidth: i["coverWidth"].d)
            near(got.fontSize, o["fontSize"].d, "jacketType size \(i.raw)")
            near(got.lineHeight, o["lineHeight"].d, "jacketType leading \(i.raw)")
        }
    }

    func testCapsType() throws {
        for c in try GoldenNode.load("golden-design").cases("capsType", atLeast: 200) {
            let (i, o) = (c["input"], c["output"])
            let got = DesignMath.capsType(i["labels"].strings, boxWidth: i["boxWidth"].d, max: i["max"].d)
            near(got.fontSize, o["fontSize"].d, "capsType size \(i.raw)")
            near(got.lineHeight, o["lineHeight"].d, "capsType leading \(i.raw)")
            near(got.letterSpacing, o["letterSpacing"].d, "capsType tracking \(i.raw)")
        }
    }

    func testQuoteType() throws {
        for c in try GoldenNode.load("golden-design").cases("quoteType", atLeast: 1000) {
            let (i, o) = (c["input"], c["output"])
            let got = DesignMath.quoteType(i["text"].s, coverWidth: i["coverWidth"].d, coverHeight: i["coverHeight"].d)
            near(got.fontSize, o["fontSize"].d, "quoteType size \(i.raw)")
            near(got.lineHeight, o["lineHeight"].d, "quoteType leading \(i.raw)")
            XCTAssertEqual(got.lines, o["lines"].i, "quoteType lines \(i.raw)")
            XCTAssertEqual(got.fits, o["fits"].b, "quoteType fits \(i.raw)")
            XCTAssertEqual(got.chars, o["chars"].isNull ? nil : o["chars"].i, "quoteType chars \(i.raw)")
        }
    }

    func testNoteType() throws {
        for c in try GoldenNode.load("golden-design").cases("noteType", atLeast: 1000) {
            let (i, o) = (c["input"], c["output"])
            let got = DesignMath.noteType(i["text"].s, coverWidth: i["coverWidth"].d, coverHeight: i["coverHeight"].d)
            XCTAssertEqual(got, .init(loud: o["loud"].b, text: o["text"].s, lines: o["lines"].i), "noteType \(i.raw)")
        }
    }

    func testExcerpt() throws {
        for c in try GoldenNode.load("golden-design").cases("excerpt", atLeast: 1000) {
            XCTAssertEqual(DesignMath.excerpt(c["input"]["text"].s, maxChars: c["input"]["maxChars"].i), c["output"].s, "excerpt \(c["input"].raw)")
        }
    }

    // ── colour ───────────────────────────────────────────────────────────────

    func testMixLuminanceAndContrast() throws {
        let g = try GoldenNode.load("golden-design")
        for c in g.cases("mix", atLeast: 300) {
            let i = c["input"]
            XCTAssertEqual(DesignMath.mix(i["a"].s, i["b"].s, i["t"].d), c["output"].s, "mix \(i.raw)")
        }
        for c in g.cases("luminance", atLeast: 15) { near(DesignMath.luminance(c["input"]["hex"].s), c["output"].d, "luminance \(c["input"].raw)") }
        for c in g.cases("contrast", atLeast: 200) { near(DesignMath.contrast(c["input"]["a"].s, c["input"]["b"].s), c["output"].d, "contrast \(c["input"].raw)") }
    }

    func testPaperLabelAndPlaceholderColours() throws {
        let g = try GoldenNode.load("golden-design")
        for c in g.cases("isPaper", atLeast: 26) {
            XCTAssertEqual(DesignMath.isPaper(c["input"]["list"].s, palettes[c["input"]["palette"].s]!), c["output"].b, "isPaper \(c["input"].raw)")
        }
        for c in g.cases("onFor", atLeast: 26) {
            XCTAssertEqual(DesignMath.onFor(c["input"]["list"].s, palettes[c["input"]["palette"].s]!), c["output"].s, "onFor \(c["input"].raw)")
        }
        for c in g.cases("placeholderOn", atLeast: 26) {
            XCTAssertEqual(DesignMath.placeholderOn(c["input"]["list"].s, palettes[c["input"]["palette"].s]!), c["output"].s, "placeholderOn \(c["input"].raw)")
        }
    }

    // ── motion ───────────────────────────────────────────────────────────────

    private func spring(_ i: GoldenNode) -> DesignMath.Spring {
        i["mass"].isNull ? DesignMath.spring(dampingRatio: i["dampingRatio"].d, settleMs: i["settleMs"].d)
            : DesignMath.spring(dampingRatio: i["dampingRatio"].d, settleMs: i["settleMs"].d, mass: i["mass"].d)
    }

    func testSprings() throws {
        let g = try GoldenNode.load("golden-design")
        for c in g.cases("spring", atLeast: 7) {
            let (got, o) = (spring(c["input"]), c["output"])
            for (name, value) in [("dampingRatio", got.dampingRatio), ("settleMs", got.settleMs), ("mass", got.mass),
                                  ("stiffness", got.stiffness), ("damping", got.damping), ("omega0", got.omega0)] {
                near(value, o[name].d, "spring \(name) \(c["input"].raw)")
            }
        }
        for c in g.cases("springAt", atLeast: 90) {
            near(DesignMath.springAt(spring(c["input"]["spring"]), c["input"]["t"].d), c["output"].d, "springAt \(c["input"].raw)")
        }
    }

    func testPressScaleAndStagger() throws {
        let g = try GoldenNode.load("golden-design")
        for c in g.cases("pressScale", atLeast: 12) { near(DesignMath.pressScale(c["input"]["sizePt"].d), c["output"].d, "pressScale \(c["input"].raw)") }
        for c in g.cases("staggerDelay", atLeast: 8) { near(DesignMath.staggerDelay(c["input"]["i"].i), c["output"].d, "staggerDelay \(c["input"].raw)") }
    }
}
