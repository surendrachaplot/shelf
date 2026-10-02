// ShelfApp.swift — the entry point, and the one place screens are stacked.
import SwiftUI

@main
struct ShelfApp: App {
    @State private var model = AppModel()
    @State private var nav = Nav()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Themed { RootView() }
                .environment(model)
                .environment(nav)
                .task { await model.boot() }
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
