// ShelfApp.swift — the entry point.
import SwiftUI

@main
struct ShelfApp: App {
    var body: some Scene {
        WindowGroup {
            Themed { RootView() }
        }
    }
}

/// Replaced by the bookcase as the screens land. Kept trivially small so the
/// project builds from the first commit.
struct RootView: View {
    @Environment(\.theme) private var theme
    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            Text("shelf").style(T.wordmark).foregroundStyle(theme.ink)
        }
    }
}
