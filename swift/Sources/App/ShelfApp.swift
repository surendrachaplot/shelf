// ShelfApp.swift — the entry point, and the one place screens are stacked.
import SwiftUI

@main
struct ShelfApp: App {
    @State private var model = DebugLaunch.model() ?? AppModel()
    @State private var nav = DebugLaunch.nav()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Themed { RootView() }
                .environment(model)
                .environment(nav)
                .task { await model.boot(); nav.applyPending(model) }
                // iOS does not relaunch a backgrounded app: anything shared
                // while it was away is taken when it comes back to the front.
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await model.refresh() } }
                }
        }
    }
}

/// The bookcase, with overlays painted above it in a FIXED order: the item
/// page, then the reader, then whichever full screen is open, then the note
/// writer, then the share sheet. Each overlay covers the whole display.
struct RootView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            if !model.ready {
                ProgressView().tint(theme.ink)
            } else {
                HomeScreen()
                if let item = nav.open { ItemScreen(item: model.item(item.id) ?? item).id(item.id) }
                if let item = nav.reading { ReaderScreen(item: item) { nav.reading = nil } }
                switch nav.screen {
                case .home: EmptyView()
                case .find: FindScreen()
                case .add: AddScreen()
                case .importPictures: ImportScreen()
                case .profile: ProfileScreen()
                case .tags: TagsScreen()
                case .lists: ListsScreen()
                }
                if nav.writing { NoteWriterScreen() }
                if let sharing = nav.sharing { ShareSheetScreen(sharing: sharing) }
            }
        }
    }
}

/// LOOKING AT A SCREEN WITHOUT TAPPING TO IT. Launch arguments, DEBUG only:
///
///   -ShelfFixture 1            start on the bundled fixture shelf, in a
///                              scratch folder, with the network pointed at
///                              nothing — never the real shelf.json.
///   -ShelfScreen find|add|import|profile|tags|lists
///   -ShelfTab restaurants      which shelf the bookcase shows
///   -ShelfOpen <item id>       open that item's page
///   -ShelfRead <item id>       open that item in the reader
///   -ShelfList <list id>       with -ShelfScreen lists: open that list
///   -ShelfAdding <item id>     with -ShelfScreen lists: "add to a list"
///   -ShelfTag <tag key>        with -ShelfScreen tags: open that tag
///   -ShelfWrite 1              the note writer
///   -ShelfShare shelf:books | item:<id> | profile
///
/// It exists for screenshots (`xcrun simctl launch booted … -ShelfFixture 1
/// -ShelfScreen tags`), which is how each screen is compared with the Expo
/// app's. A Release build ignores all of it.
enum DebugLaunch {
    private static func arg(_ name: String) -> String? { UserDefaults.standard.string(forKey: name) }

    @MainActor static func model() -> AppModel? {
        #if DEBUG
        guard arg("ShelfFixture") != nil,
              let src = Bundle.main.url(forResource: "shelf", withExtension: "json", subdirectory: "Debug")
                ?? Bundle.main.url(forResource: "shelf", withExtension: "json") else { return nil }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-fixture", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.copyItem(at: src, to: dir.appendingPathComponent("shelf.json"))
        // A port nothing listens on: the fixture must never call the real server.
        return AppModel(directory: dir, api: API(base: URL(string: "http://127.0.0.1:9")!))
        #else
        return nil
        #endif
    }

    @MainActor static func nav() -> Nav {
        let nav = Nav()
        #if DEBUG
        if let t = arg("ShelfTab") { nav.tab = t }
        switch arg("ShelfScreen") {
        case "find": nav.screen = .find
        case "add": nav.screen = .add
        case "import": nav.screen = .importPictures
        case "profile": nav.screen = .profile
        case "tags": nav.screen = .tags
        case "lists": nav.screen = .lists
        default: break
        }
        nav.tagStart = arg("ShelfTag")
        nav.listStart = arg("ShelfList")
        nav.pendingOpen = arg("ShelfOpen")
        nav.pendingRead = arg("ShelfRead")
        nav.pendingAdding = arg("ShelfAdding")
        nav.pendingShare = arg("ShelfShare")
        nav.writing = arg("ShelfWrite") != nil
        #endif
        return nav
    }
}
