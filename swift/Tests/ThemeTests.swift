import XCTest
import SwiftUI
@testable import shelf

final class ThemeTests: XCTestCase {
    func testTheShelvesAreDerivedFromTheGeneratedKeys() {
        XCTAssertEqual(Lists.shelves.map(\.key), Tokens.listKeys.filter { $0 != "unsorted" })
        XCTAssertEqual(Lists.info("wishlist").n, "07")
        XCTAssertEqual(Lists.info("unsorted").n, "00")
        XCTAssertTrue(Theme(.light).isPaper("notes") && !Theme(.light).isPaper("books"))
    }
}
