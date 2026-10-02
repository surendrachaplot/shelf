// PhotoPick.swift — pick pictures from the photo library, as bytes.
//
// `PHPickerViewController` runs OUT OF PROCESS: the person picks in the
// system's own screen and this app is handed only what they chose. So there is
// NO PERMISSION PROMPT and nothing to be denied — the "shelf can't see your
// photos" and "limited access" branches of the Expo app's Import screen have
// no equivalent here, on purpose. (No `photoLibrary:` is passed to the
// configuration, which is what keeps it that way.)
//
// Used by Import (up to 20 screenshots) and by Lists' "Add pictures" (12).
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct PhotoPick: UIViewControllerRepresentable {
    /// The most pictures one pick may hold.
    var limit: Int
    /// Called AT ONCE when the picker is finished, with how many were chosen
    /// (0 = cancelled): close the sheet here and show that work has started.
    var onChosen: (Int) -> Void
    /// Called once the bytes are read, in the order they were picked. A
    /// picture that could not be read (an iCloud original that never arrived)
    /// is left out. Not called after a cancel.
    var onData: ([Data]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = limit
        config.selection = .ordered
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: PHPickerViewController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let parent: PhotoPick
        init(_ parent: PhotoPick) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            let type = UTType.image.identifier
            let providers = results.map(\.itemProvider).filter { $0.hasItemConformingToTypeIdentifier(type) }
            parent.onChosen(providers.count)
            guard !providers.isEmpty else { return }
            let parent = parent
            Task { @MainActor in
                var datas: [Data] = []
                // One at a time: twenty full-size screenshots read at once is
                // twenty held in memory at once.
                for provider in providers {
                    let data: Data? = await withCheckedContinuation { done in
                        _ = provider.loadDataRepresentation(forTypeIdentifier: type) { data, _ in done.resume(returning: data) }
                    }
                    if let data { datas.append(data) }
                }
                parent.onData(datas)
            }
        }
    }
}
