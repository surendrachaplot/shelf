// ExLibris.swift — a personal mark, generated from a handle.
// A port of the generator in app/src/exlibris.js, checked against it over
// 140 handles (golden-exlibris.json).
//
// The bookplate tradition: you pasted your plate inside the cover, and it said
// who you were before a word of the book did. A shelf you share needs a mark
// that is unmistakably yours.
//
// ONE GENERATOR, MANY RENDERERS. This returns a DESCRIPTION, never a drawing.
// The Expo app draws it with react-native-svg, the server draws it into the
// public page, and this app draws it in SwiftUI — and all three must give the
// same plate down to the point, or it is not an identity. So nothing here may
// be "improved": a plate somebody already has must not change.
//
// Colours are ROLE NAMES (ground, mark, paper), never values. No component
// invents a colour; `colours(for:palette:)` resolves the roles.
import Foundation

enum ExLibris {
    /// The viewBox every shape below is drawn in: 0...100 both ways.
    static let plate: Double = 100

    // THE GROUNDS A PLATE CAN STAND ON, and why this is not "every shelf".
    // The ground is picked by `seed % count`, so adding a shelf to this list
    // would hand every person who already has a plate a different one.
    // Wishlist and Notes arrived after plates did, so they are left out: the
    // first six, for good. deliberate subset.
    static let grounds = Array(DesignConstants.listKeys.prefix(6))
    static let borders = ["double", "heavy", "brackets", "stepped"]
    static let devices = ["ring", "diamond", "bars", "arc", "cross"]

    enum Role: String, Sendable { case ground, mark, paper }

    struct Plate: Equatable, Sendable {
        let seed: UInt32
        /// Up to two letters or digits of the handle, upper case. "?" if none.
        let letters: String
        /// The shelf whose colour is the ground. Never "unsorted": grey is the
        /// colour of a thing with no shelf yet, and a person is not that.
        let list: String
        let border: String
        let device: String
        /// What is printed: one letter reads as a monogram, two as initials.
        let mono: String
    }

    /// A 32-bit hash (FNV-1a over the first UTF-16 unit of each code point of
    /// the lower-cased handle). This is an identity, so it must give the same
    /// number here, on Android, in Chromium and in Node, forever.
    static func seed(of handle: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        // NSString's lower-casing, not `String.lowercased()`: JS turns a final
        // capital sigma into ς, NSString does too, and Swift's own does not.
        for s in (handle as NSString).lowercased.unicodeScalars {
            h ^= UInt32(s.utf16[s.utf16.startIndex])
            h = h &* 16_777_619
        }
        return h
    }

    // Each draw uses a different slice of the bits, so two handles that share
    // a first letter do not end up sharing a border AND a device AND a ground.
    private static func pick(_ seed: UInt32, _ shift: UInt32, _ list: [String]) -> String {
        list[Int(seed >> shift) % list.count]
    }

    /// Everything about a plate, derived. Nothing is chosen by taste.
    ///
    /// Pass the SEED the profile holds (the handle when it was first set), not
    /// the current handle: somebody can rename themselves without their mark
    /// changing under the people who recognise it.
    static func plate(for handle: String) -> Plate {
        let seed = seed(of: handle)
        let ascii = (handle.isEmpty ? "?" : handle).unicodeScalars.filter {
            ("A"..."Z").contains($0) || ("a"..."z").contains($0) || ("0"..."9").contains($0)
        }.prefix(2)
        let letters = ascii.isEmpty ? "?" : String(String.UnicodeScalarView(ascii)).uppercased()
        return Plate(seed: seed, letters: letters,
                     list: pick(seed, 3, grounds), border: pick(seed, 11, borders), device: pick(seed, 17, devices),
                     mono: (seed >> 23) % 3 == 0 ? String(letters.prefix(1)) : letters)
    }

    struct Colours: Equatable, Sendable { let ground: String; let mark: String; let paper: String }

    /// The three roles against a palette (`DesignConstants.light` / `.dark`),
    /// as "#RRGGBB". Resolve against the LIVE scheme. The mark is the label
    /// colour the shelf already names for itself, so its contrast is a pairing
    /// already proven, not a new one.
    static func colours(for handle: String, palette: [String: String]) -> Colours {
        let p = plate(for: handle)
        return Colours(ground: palette[p.list] ?? "", mark: DesignMath.onFor(p.list, palette), paper: palette["bg"] ?? "")
    }

    /// One primitive. `fill` and `stroke` are roles; nil is "none". `sw` is the
    /// stroke width, in plate units. An arc is in degrees, clockwise, y down.
    /// Text is centred on `x`, baseline at `y`, bold, tracking -1, in the
    /// app's one family.
    enum Shape: Equatable, Sendable {
        case rect(x: Double, y: Double, w: Double, h: Double, fill: Role?, stroke: Role?, sw: Double)
        case circle(cx: Double, cy: Double, r: Double, stroke: Role, sw: Double)
        case line(x1: Double, y1: Double, x2: Double, y2: Double, stroke: Role, sw: Double)
        case poly(points: [[Double]], stroke: Role, sw: Double)
        case arc(cx: Double, cy: Double, r: Double, from: Double, to: Double, stroke: Role, sw: Double)
        case text(x: Double, y: Double, value: String, size: Double, fill: Role)
    }

    /// The plate as primitives, in draw order, in a 0...100 box.
    static func shapes(for handle: String) -> [Shape] {
        let p = plate(for: handle)
        var out: [Shape] = [.rect(x: 0, y: 0, w: plate, h: plate, fill: .ground, stroke: nil, sw: 0)]

        switch p.border {
        case "double":
            out.append(.rect(x: 6, y: 6, w: 88, h: 88, fill: nil, stroke: .mark, sw: 2.5))
            out.append(.rect(x: 12, y: 12, w: 76, h: 76, fill: nil, stroke: .mark, sw: 1))
        case "heavy":
            out.append(.rect(x: 5, y: 5, w: 90, h: 90, fill: nil, stroke: .mark, sw: 6))
        case "brackets":
            // Corner brackets only — the plate is implied rather than enclosed.
            for (x, y, dx, dy) in [(8.0, 8.0, 1.0, 1.0), (92, 8, -1, 1), (8, 92, 1, -1), (92, 92, -1, -1)] {
                out.append(.line(x1: x, y1: y, x2: x + 22 * dx, y2: y, stroke: .mark, sw: 3))
                out.append(.line(x1: x, y1: y, x2: x, y2: y + 22 * dy, stroke: .mark, sw: 3))
            }
        default:
            // stepped: a rule top and bottom, weighted like a masthead.
            out.append(.rect(x: 0, y: 6, w: plate, h: 5, fill: .mark, stroke: nil, sw: 0))
            out.append(.rect(x: 0, y: 89, w: plate, h: 5, fill: .mark, stroke: nil, sw: 0))
        }

        switch p.device {
        case "ring":
            out.append(.circle(cx: 50, cy: 50, r: 27, stroke: .mark, sw: 2))
        case "diamond":
            out.append(.poly(points: [[50, 20], [80, 50], [50, 80], [20, 50]], stroke: .mark, sw: 2))
        case "bars":
            for i in 0..<3 { out.append(.rect(x: 22, y: 30 + Double(i) * 17, w: 56, h: 2, fill: .mark, stroke: nil, sw: 0)) }
        case "arc":
            out.append(.arc(cx: 50, cy: 52, r: 26, from: 180, to: 360, stroke: .mark, sw: 2.5))
        default:
            out.append(.line(x1: 24, y1: 50, x2: 76, y2: 50, stroke: .mark, sw: 2))
            out.append(.line(x1: 50, y1: 24, x2: 50, y2: 76, stroke: .mark, sw: 2))
        }

        // The monogram sits ON the device, knocked out of a small field of the
        // ground so the device never runs through the letterforms — a ring
        // crossing an "S" at the waist is the difference between a mark and a mess.
        let one = p.mono.utf16.count == 1
        let w: Double = one ? 30 : 44
        out.append(.rect(x: 50 - w / 2, y: 36, w: w, h: 28, fill: .ground, stroke: nil, sw: 0))
        out.append(.text(x: 50, y: 59, value: p.mono, size: one ? 30 : 24, fill: .mark))
        return out
    }
}
