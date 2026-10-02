import XCTest
@testable import shelf

/// `Pile.whyUnread` against the four answers of `whyUnread` in app/App.tsx.
final class HomeLayoutTests: XCTestCase {
    func testWhyUnreadSaysADifferentThingPerCause() {
        XCTAssertNil(Pile.whyUnread(Item(id: "a", list: "unsorted", title: "Kiln")))
        XCTAssertEqual(Pile.whyUnread(Item(id: "b", list: "unsorted", resolver: "caption", error: "timed out")),
                       "It went wrong while reading: timed out")
        XCTAssertTrue(Pile.whyUnread(Item(id: "c", list: "unsorted", resolver: "none"))!.hasPrefix("Instagram gave us nothing"))
        XCTAssertTrue(Pile.whyUnread(Item(id: "d", list: "unsorted", title: ""))!.hasPrefix("Instagram gave us nothing"))
        XCTAssertEqual(Pile.whyUnread(Item(id: "e", list: "unsorted", resolver: "caption")),
                       "We got the caption but couldn't tell what it was about.")
    }
}
