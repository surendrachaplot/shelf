// ShareFile.swift — the system share sheet, for a file or a link.
//
// "Save to Files", AirDrop, Mail, Messages and Copy are all in the sheet iOS
// already has. Rebuilding a row of those inside the app would be a worse
// version of a thing the system does perfectly (app/src/saveFile.ts, and
// `handOver` in ShareSheet.tsx).
//
//     @State private var share: ShareItems?
//     …
//     .shareSheet($share) { completed in … }
//
// `completed` is false when the person backed out. "You cancelled" and "it
// broke" must not look the same, so a failure to WRITE the file is the
// caller's to report — this only says whether the sheet did something.
import SwiftUI
import UIKit

/// What is handed to the sheet: file URLs, links, text.
struct ShareItems: Identifiable {
    let id = UUID()
    var items: [Any]
}

struct ShareFile: UIViewControllerRepresentable {
    var items: [Any]
    var onDone: @MainActor (Bool) -> Void = { _ in }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        let done = onDone
        vc.completionWithItemsHandler = { _, completed, _, _ in
            Task { @MainActor in done(completed) }
        }
        return vc
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

private struct ShareSheetModifier: ViewModifier {
    @Binding var share: ShareItems?
    var onDone: (Bool) -> Void
    @State private var completed = false

    func body(content: Content) -> some View {
        // `onDismiss` and not the handler is what reports: it runs exactly
        // once however the sheet went away, including a swipe down.
        content.sheet(item: $share, onDismiss: { onDone(completed); completed = false }) { s in
            ShareFile(items: s.items) { ok in
                completed = ok
                share = nil
            }
            .presentationDetents([.medium, .large])
            .ignoresSafeArea()
        }
    }
}

extension View {
    /// Presents the system share sheet while `share` is set.
    func shareSheet(_ share: Binding<ShareItems?>, onDone: @escaping (Bool) -> Void = { _ in }) -> some View {
        modifier(ShareSheetModifier(share: share, onDone: onDone))
    }
}

/// Write an export to the temporary directory, ready to hand to the sheet.
/// Throws the real reason when the write fails.
func writeTemporaryFile(named name: String, text: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    try Data(text.utf8).write(to: url, options: .atomic)
    return url
}
