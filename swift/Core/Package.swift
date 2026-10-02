// swift-tools-version:6.0
// ShelfCore — everything that is not a screen: the shelf file, the API client
// and the pure logic (find, tags, links, lists, facts, serendipity, export).
//
// A PACKAGE ONLY SO IT CAN BE TESTED WITHOUT A SIMULATOR. `swift test` runs
// these on the Mac in seconds, with no device booted — which matters on a
// machine where one simulator at a time is the rule. The app does not import
// this as a module: project.yml compiles the same source folder straight into
// the app target, so nothing here needs to be `public`.
import PackageDescription

let package = Package(
    name: "ShelfCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    targets: [
        .target(name: "ShelfCore", path: "Sources/ShelfCore"),
        .testTarget(name: "ShelfCoreTests", dependencies: ["ShelfCore"], path: "Tests/ShelfCoreTests",
                    resources: [.copy("Fixtures")]),
    ]
)
