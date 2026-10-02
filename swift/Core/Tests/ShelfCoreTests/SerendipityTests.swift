// SerendipityTests — Serendipity.swift against the real serendipity.js.
//
// Two things here cannot be checked by looking at a screen. One is time: "a
// year ago this week" is right on one day in 365. The other is the claim that
// matters most — OPEN NOW — which is wrong silently. So the golden file is
// mostly the list of hours `openState` must say NOTHING about, each asked at
// instants across a week and around midnight.
//
// THE ZONE IS PINNED to Asia/Kolkata in the golden script, five and a half
// hours off UTC, so local time and UTC never agree by luck — and a block of
// cases in New York, Auckland and UTC proves the `timeZone` argument is read.
import XCTest
@testable import ShelfCore

final class SerendipityTests: XCTestCase {
    func testMetresBetween() throws {
        func pin(_ n: GoldenNode) -> Serendipity.LatLng? { n.isNull ? nil : .init(lat: n["lat"].d, lng: n["lng"].d) }
        for c in try GoldenNode.load("golden-serendipity").cases("metresBetween", atLeast: 140) {
            let got = Serendipity.metresBetween(pin(c["input"]["a"]), pin(c["input"]["b"]))
            if c["output"].isNull { XCTAssertNil(got, "metresBetween \(c["input"].raw)") } else {
                // A MICROMETRE, not 1e-9: across half the planet the last bit of
                // the answer differs (4e-9 m in 17,000 km), because V8's sin, cos
                // and asin are one library and Apple's are another.
                XCTAssertEqual(try XCTUnwrap(got, "metresBetween \(c["input"].raw)"), c["output"].d, accuracy: 1e-6, "metresBetween \(c["input"].raw)")
            }
        }
    }

    func testOpenStateSaysWhatJsSaysAndNothingWhereJsSaysNothing() throws {
        var zones = Set<String>(), unknown = 0, open = 0, shut = 0
        for c in try GoldenNode.load("golden-serendipity").cases("openState", atLeast: 2500) {
            let (i, o) = (c["input"], c["output"])
            let got = Serendipity.openState(i["hours"].s, now: i["nowMs"].date, timeZone: i["tz"].zone)
            let want: Serendipity.OpenState? = o.isNull ? nil : .init(open: o["open"].b, until: o["until"].isNull ? nil : o["until"].s)
            XCTAssertEqual(got, want, "openState(\(i["hours"].s.debugDescription)) at \(i["nowMs"].d) in \(i["tz"].s)")
            zones.insert(i["tz"].s)
            if let want { if want.open { open += 1 } else { shut += 1 } } else { unknown += 1 }
        }
        // The golden file has all three answers and more than one zone in it,
        // or it is not testing what its name says.
        XCTAssertGreaterThan(unknown, 500); XCTAssertGreaterThan(open, 300); XCTAssertGreaterThan(shut, 500)
        XCTAssertGreaterThanOrEqual(zones.count, 4)
        XCTAssertNil(Serendipity.openState(nil, now: Date(timeIntervalSince1970: 0)), "no hours, no claim")
    }

    func testSurfaceGivesTheSameCardsInTheSameOrderWithTheSameWords() throws {
        var kinds = Set<String>(), zones = Set<String>()
        for c in try GoldenNode.load("golden-serendipity").cases("surface", atLeast: 70) {
            let i = c["input"]
            let items = try i["items"].decode([Item].self)
            let here: Serendipity.LatLng? = i["here"]["lat"].raw is NSNumber && i["here"]["lng"].raw is NSNumber
                ? .init(lat: i["here"]["lat"].d, lng: i["here"]["lng"].d) : nil
            let seen = i["seen"].strings
            // No limit in the case means the DEFAULT is under test: call without one.
            let got = i["limit"].isNull
                ? Serendipity.surface(items, now: i["nowMs"].date, here: here, seen: seen, timeZone: i["tz"].zone)
                : Serendipity.surface(items, now: i["nowMs"].date, here: here, limit: i["limit"].i, seen: seen, timeZone: i["tz"].zone)
            let line = { (kind: String, id: String, reason: String, action: String) in "\(kind) | \(id) | \(reason) | \(action)" }
            XCTAssertEqual(got.map { line($0.kind.rawValue, $0.item.id, $0.reason, $0.action.map { "\($0.type):\($0.label)" } ?? "-") },
                           c["output"].list.map { line($0["kind"].s, $0["id"].s, $0["reason"].s, $0["action"].isNull ? "-" : "\($0["action"]["type"].s):\($0["action"]["label"].s)") },
                           "surface: \(i["name"].s)")
            for card in got {
                XCTAssertEqual(card.item, items.first { $0.id == card.item.id }, "the card carries the item, whole")
                kinds.insert(card.kind.rawValue)
            }
            zones.insert(i["tz"].s)
        }
        XCTAssertEqual(kinds, ["open-now", "near", "year-ago", "forgotten"], "the golden cases do not reach every kind of card")
        XCTAssertGreaterThanOrEqual(zones.count, 4)
    }

    /// `created_at` is read the way `new Date(string)` reads it. Swift reads
    /// the ISO forms. V8 also has an older, looser parser; what only THAT
    /// reads is listed here by name, so the difference is a decision and not
    /// an accident — and a new one fails.
    func testDatesAreReadTheWayJsReadsThem() throws {
        let onlyTheLooseParser: Set<String> = [
            "2026-10-01 12:00:00", "2026-10-01T12:00:00+0530", "2026-1-1", "Oct 1 2026", "1 October 2026 13:00",
            "Thu, 01 Oct 2026 07:30:00 GMT", "10/01/2026", "+002026-10-01T00:00:00Z", "0", "202-10-01", "２０２６-10-01",
        ]
        var met = Set<String>()
        for c in try GoldenNode.load("golden-serendipity").cases("dates", atLeast: 150) {
            let (text, tz) = (c["input"]["text"].s, c["input"]["tz"].zone)
            let got = JSCompat.parseDate(text, tz)
            if onlyTheLooseParser.contains(text) {
                XCTAssertFalse(c["output"].isNull, "\(text.debugDescription) is listed as a date only JS reads, and JS does not read it")
                XCTAssertNil(got, "\(text.debugDescription) is listed as a date Swift does not read, and it does")
                met.insert(text)
            } else {
                XCTAssertEqual(got, c["output"].isNull ? nil : c["output"].d, "new Date(\(text.debugDescription)) in \(c["input"]["tz"].s)")
            }
        }
        XCTAssertEqual(met, onlyTheLooseParser, "a listed difference is not in the golden file")
    }
}
