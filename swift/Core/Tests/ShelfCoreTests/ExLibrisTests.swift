// ExLibrisTests — the plate generator against the real exlibris.js.
//
// A plate is an identity: the one somebody already has must not change. So
// every handle in golden-exlibris.json must give the same seed, letters,
// ground, border, device, colours and shapes that the JS gives.
import XCTest
@testable import ShelfCore

final class ExLibrisTests: XCTestCase {
    func testTheListsAPlateIsPickedFrom() throws {
        let c = try GoldenNode.load("golden-exlibris")["constants"]
        XCTAssertEqual(ExLibris.plate, c["plate"].d)
        XCTAssertEqual(ExLibris.grounds, c["grounds"].strings)
        XCTAssertEqual(ExLibris.borders, c["borders"].strings)
        XCTAssertEqual(ExLibris.devices, c["devices"].strings)
        XCTAssertEqual(c["roles"].strings, ["ground", "mark", "paper"].filter { ExLibris.Role(rawValue: $0) != nil })
    }

    func testEveryHandleGivesThePlateJsGives() throws {
        for c in try GoldenNode.load("golden-exlibris").cases("plate", atLeast: 100) {
            let handle = c["input"]["handle"].s
            let (o, what) = (c["output"], "handle \(handle.debugDescription)")
            let p = o["plate"]
            XCTAssertEqual(ExLibris.seed(of: handle), UInt32(p["seed"].d), "seed, \(what)")
            XCTAssertEqual(ExLibris.plate(for: handle),
                           .init(seed: UInt32(p["seed"].d), letters: p["letters"].s, list: p["list"].s, border: p["border"].s, device: p["device"].s, mono: p["mono"].s), what)
            for (name, palette) in [("light", DesignConstants.light), ("dark", DesignConstants.dark)] {
                XCTAssertEqual(ExLibris.colours(for: handle, palette: palette),
                               .init(ground: o[name]["ground"].s, mark: o[name]["mark"].s, paper: o[name]["paper"].s), "\(name) colours, \(what)")
            }
            XCTAssertEqual(ExLibris.shapes(for: handle), try o["shapes"].list.map(shape), "shapes, \(what)")
        }
    }

    /// One JS primitive as the Swift case. A key the Swift case does not carry
    /// (a text's weight and anchor are the same on every plate) is CHECKED
    /// here, so the day JS varies it this fails instead of drifting.
    private func shape(_ s: GoldenNode) throws -> ExLibris.Shape {
        func role(_ key: String) -> ExLibris.Role? { s[key].isNull ? nil : ExLibris.Role(rawValue: s[key].s) }
        let sw = s["sw"].isNull ? 0 : s["sw"].d
        switch s["k"].s {
        case "rect": return .rect(x: s["x"].d, y: s["y"].d, w: s["w"].d, h: s["h"].d, fill: role("fill"), stroke: role("stroke"), sw: sw)
        case "circle": return .circle(cx: s["cx"].d, cy: s["cy"].d, r: s["r"].d, stroke: try XCTUnwrap(role("stroke")), sw: sw)
        case "line": return .line(x1: s["x1"].d, y1: s["y1"].d, x2: s["x2"].d, y2: s["y2"].d, stroke: try XCTUnwrap(role("stroke")), sw: sw)
        case "poly": return .poly(points: s["pts"].list.map { $0.list.map(\.d) }, stroke: try XCTUnwrap(role("stroke")), sw: sw)
        case "arc": return .arc(cx: s["cx"].d, cy: s["cy"].d, r: s["r"].d, from: s["from"].d, to: s["to"].d, stroke: try XCTUnwrap(role("stroke")), sw: sw)
        case "text":
            XCTAssertEqual(s["weight"].s, "700", "a plate's text is no longer always bold: ExLibris.Shape.text must carry the weight")
            XCTAssertEqual(s["anchor"].s, "middle", "a plate's text is no longer always centred: ExLibris.Shape.text must carry the anchor")
            return .text(x: s["x"].d, y: s["y"].d, value: s["value"].s, size: s["size"].d, fill: try XCTUnwrap(role("fill")))
        default:
            XCTFail("a primitive the Swift port does not know: \(s["k"].s)")
            return .text(x: 0, y: 0, value: "", size: 0, fill: .mark)
        }
    }
}
