// NoteWriterScreen.swift — a note, written down.
//
// A port of app/src/NoteWriter.tsx. A note is an ITEM: it stands on the Notes
// shelf, Find reads it, a list can hold it, and Take a copy carries it out.
// The only thing this screen does is make one (`AppModel.addNote`, which is
// where the shape of a note lives).
//
// Full screen and nothing else on it. The field is the whole page, so there is
// nothing to scroll past — and NOTHING UNDER THE KEYBOARD: the column stays
// inside the safe area, which the keyboard shortens, so the field gets
// shorter and the button rides up on top of the keys.
//
// Paper: file "shelf" → "Notes shelf — 08, and writing a note".
import SwiftUI

struct NoteWriterScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme
    @State private var text = ""
    @FocusState private var focused: Bool

    private static let noteMax = 4000
    // `TextEditor` is a UITextView: it sets its text in by 5pt at the sides
    // and 8pt above and below. Taken off the 12pt the design asks for, so the
    // words start where the placeholder does.
    private let inset = CGSize(width: 5, height: 8)

    private var said: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Micro("New note", color: theme.inkSoft).accessibilityAddTraits(.isHeader)
                Spacer(minLength: Tokens.Space.md)
                TextAction(title: "Close") { close() }
            }
            .padding(.top, Tokens.Space.xl)
            .padding(.bottom, Tokens.Space.sm)
            Rule()

            // The field takes the screen.
            TextEditor(text: $text)
                .style(T.body)
                .foregroundStyle(theme.ink)
                .tint(theme.ink)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .padding(.horizontal, Tokens.Space.md - inset.width)
                .padding(.vertical, Tokens.Space.md - inset.height)
                .background(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("Write it down").style(T.body).foregroundStyle(theme.inkFaint)
                            .padding(Tokens.Space.md)
                            .accessibilityHidden(true)
                    }
                }
                .padding(Tokens.coverKeyline)
                .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: Tokens.coverKeyline))
                .frame(maxHeight: .infinity)
                .padding(.top, Tokens.Space.lg)
                .accessibilityLabel("Write it down")
                .onChange(of: text) { _, now in
                    if now.count > Self.noteMax { text = String(now.prefix(Self.noteMax)) }
                }

            HStack {
                ShelfButton(title: "Save note →", kind: .fill, label: "Save the note") { save() }
                Spacer(minLength: 0)
            }
            .padding(.vertical, Tokens.Space.lg)
        }
        .padding(.horizontal, Tokens.Space.lg)
        .background(theme.bg.ignoresSafeArea())
        .onAppear { focused = true }
    }

    private func save() {
        // Nothing written is not a note. The button does not go grey (it does
        // not in the Expo app); it does nothing.
        guard !said.isEmpty else { return }
        let listId = nav.writingFor
        model.addNote(text, pinTo: listId)
        // Written from the bookcase: show the shelf it now stands on.
        if listId == nil { nav.tab = "notes" }
        close()
    }

    private func close() {
        nav.writing = false
        nav.writingFor = nil
    }
}

#if DEBUG
#Preview("Note writer") { FixtureStage { NoteWriterScreen() } }
#Preview("Note writer, dark") { FixtureStage { NoteWriterScreen() }.preferredColorScheme(.dark) }
#endif
