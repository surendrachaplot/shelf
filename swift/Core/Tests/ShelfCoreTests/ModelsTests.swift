import XCTest
@testable import ShelfCore

final class ModelsTests: XCTestCase {
    func testAShelfTheExpoAppWroteLoadsAndKeepsWhatItDoesNotKnow() throws {
        let json = """
        {"version":1,"items":[{"id":"a","list":"books","status":"filed","title":"Piranesi","subtitle":"Susanna Clarke",
        "note":"","image_url":null,"canonical":{"year":2020,"author":"Susanna Clarke","subjects":["Fantasy"],"article":{"text":"x"}},
        "confidence":0.9,"enriched":true,"source_url":"https://x","resolver":"embed","created_at":"2026-08-01T00:00:00Z",
        "future_key":{"a":1}}],
        "profile":{"name":"Suren","bio":"","seed":"s","home_city":"London"},"links":null,"boards":[{"id":"l","name":"Trip","pins":"nope"}]}
        """.data(using: .utf8)!
        let shelf = try JSONDecoder().decode(Shelf.self, from: json)
        XCTAssertEqual(shelf.items.count, 1)
        XCTAssertEqual(shelf.items[0].canonical["year"]?.number, 2020)
        XCTAssertEqual(shelf.items[0].extra["future_key"]?["a"]?.number, 1, "an unknown key survives the load")
        XCTAssertEqual(shelf.links, [], "links: null is an empty array, not a crash and not an empty shelf")
        XCTAssertEqual(shelf.boards.first?.pins, [], "a board with a bad pins field is repaired, not dropped")
        XCTAssertEqual(shelf.profile.homeCity, "London")

        let back = try JSONDecoder().decode(Shelf.self, from: JSONEncoder().encode(shelf))
        XCTAssertEqual(back, shelf, "a save and a load give the same shelf")
        let text = String(data: try JSONEncoder().encode(shelf), encoding: .utf8)!
        XCTAssertTrue(text.contains("\"year\":2020"), "a whole number is written without a decimal point")
        XCTAssertTrue(text.contains("future_key"), "and the unknown key is written back")
    }

    func testAFileThatIsNotAShelfThrows() {
        XCTAssertThrowsError(try JSONDecoder().decode(Shelf.self, from: Data("{\"items\":null}".utf8)))
    }
}
