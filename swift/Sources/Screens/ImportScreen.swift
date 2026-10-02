// ImportScreen.swift — bring screenshots in from the camera roll.
//
// A port of app/src/Import.tsx. THE SHARE SHEET IS NOT THE ONLY WAY IN.
// Screenshots pile up: a bookshop, a menu, a film poster, a page of a book,
// and by the end of a week the camera roll holds twenty things you meant to
// keep. So: pick many, read many, file many.
//
// WHAT IS NOT HERE, and why. The Expo screen has a "shelf can't see your
// photos" state and a "this build can't open your photos" state. The system
// picker (`PhotoPick`) needs no permission and is in every build, so neither
// can happen and neither is drawn.
//
// The picker only CHOOSES. `AppModel.importScreenshots` does the reading.
import SwiftUI
import UIKit

struct ImportScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    private enum Phase: Equatable {
        case idle
        /// Chosen in the picker; the bytes are still being handed over.
        case fetching
        case chosen
        case reading(Int)
    }

    @State private var phase: Phase = .idle
    @State private var picking = false
    @State private var picked: [Data] = []
    /// Small copies for the strip. Nil = a picture that would not draw.
    @State private var thumbs: [UIImage?] = []

    // The React Native `thumb` style.
    private let thumbSize = CGSize(width: 72, height: 128)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Import screenshots").style(T.section).foregroundStyle(theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Tokens.Space.md)
                TextAction(title: "Close", color: theme.inkSoft) { nav.close() }
            }
            .padding(.bottom, Tokens.Space.lg)

            switch phase {
            case .fetching:
                ProgressView().tint(theme.ink)
            case .reading(let total):
                VStack(alignment: .leading, spacing: Tokens.Space.md) {
                    ProgressView().tint(theme.ink)
                    note("Reading \(total) \(total == 1 ? "picture" : "pictures")…")
                }
            case .chosen:
                chosen
            case .idle:
                VStack(alignment: .leading, spacing: Tokens.Space.md) {
                    note("Pick screenshots of posts, book covers, menus or posters. shelf reads the words in them and files what it finds.")
                    Press("Choose screenshots", size: Tokens.touchMin, action: { picking = true }) {
                        Text("Choose screenshots →").style(T.micro).foregroundStyle(theme.ink)
                            .modifier(InkBox(pad: Tokens.Space.lg, border: Tokens.rule))
                    }
                    .padding(.top, Tokens.Space.sm)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Tokens.Space.lg)
        .padding(.top, Tokens.Space.xl)
        .background(theme.bg.ignoresSafeArea())
        .sheet(isPresented: $picking) {
            PhotoPick(limit: 20, onChosen: { n in
                picking = false
                if n > 0 { phase = .fetching }
            }, onData: { datas in
                guard !datas.isEmpty else { phase = .idle; return }
                picked = datas
                thumbs = datas.map { d in
                    Pictures.shrinkJPEG(data: d, maxEdge: Int(thumbSize.height) * 3, quality: Pictures.keepQuality)
                        .flatMap(UIImage.init(data:))
                }
                phase = .chosen
            })
            .ignoresSafeArea()
        }
    }

    private var chosen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView(.horizontal) {
                    HStack(spacing: Tokens.Space.sm) {
                        ForEach(Array(thumbs.enumerated()), id: \.offset) { _, image in
                            // A strip of twelve still reads as twelve when one
                            // of them will not draw.
                            ZStack {
                                theme.surfaceSunk
                                if let image { Image(uiImage: image).resizable().scaledToFill() }
                                else { Text("—").style(T.meta).foregroundStyle(theme.inkFaint) }
                            }
                            .frame(width: thumbSize.width, height: thumbSize.height)
                            .clipped()
                        }
                    }
                    .padding(.vertical, Tokens.Space.sm)
                }
                .scrollIndicators(.hidden)
                .accessibilityHidden(true)

                Text("\(picked.count) \(picked.count == 1 ? "picture" : "pictures") — which shelf?")
                    .style(T.section).monospacedDigit().foregroundStyle(theme.ink)
                    .padding(.top, Tokens.Space.md)

                // The same shelves, same colours, same order as the share
                // sheet. A second way in that files things differently is a
                // second app. These are a picker's bands, not buttons: each
                // runs the width of the page.
                VStack(spacing: Tokens.Space.sm) {
                    ForEach(Lists.shelves, id: \.key) { l in
                        Press("File on \(l.label)", size: Tokens.touchMin, action: { file(l.key) }) {
                            Text(l.label).style(T.micro).foregroundStyle(theme.on(l.key))
                                .padding(.horizontal, Tokens.Space.lg)
                                .frame(maxWidth: .infinity, minHeight: Tokens.touchMin, alignment: .leading)
                                .background(theme.field(l.key))
                                .overlay(theme.isPaper(l.key) ? Rectangle().strokeBorder(theme.ink, lineWidth: Tokens.coverKeyline) : nil)
                        }
                    }
                }
                .padding(.top, Tokens.Space.md)

                // Not sure: shelf reads each picture and picks the shelf.
                ShelfButton(title: "Decide for me →", label: "Let shelf decide which shelf") { file("unsorted") }
                    .padding(.top, Tokens.Space.md)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, Tokens.Space.huge)
        }
        .scrollIndicators(.hidden)
    }

    private func note(_ text: String) -> some View {
        Text(text).rowLine(T.meta).foregroundStyle(theme.inkSoft).fixedSize(horizontal: false, vertical: true)
    }

    private func file(_ list: String) {
        guard phase == .chosen else { return }
        let datas = picked
        phase = .reading(datas.count)
        // The rows go onto that shelf at once, as "reading"; show it.
        nav.tab = list
        Task {
            await model.importScreenshots(datas, list: list)
            nav.close()
        }
    }
}

#if DEBUG
#Preview("Import") { FixtureStage { ImportScreen() } }
#Preview("Import, dark") { FixtureStage { ImportScreen() }.preferredColorScheme(.dark) }
#endif
