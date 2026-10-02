// Soon.swift — the placeholder a screen shows until it is written.
import SwiftUI

struct Soon: View {
    @Environment(\.theme) private var theme
    @Environment(Nav.self) private var nav
    var name: String
    var body: some View {
        VStack(spacing: 0) {
            ScreenHead(title: name) { TextAction(title: "Close") { nav.close() } }
            Spacer()
        }
        .background(theme.bg.ignoresSafeArea())
    }
}

