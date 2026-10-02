// ShareViewController.swift — the iOS host for the picker.
//
// Keep it thin. It pins the picker to the foot of the sheet at 420pt (what
// the Expo extension's `height: 420` did), hands the model what was shared,
// and closes. Everything drawn is in ShareBoards.swift.
import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
    static let sheetHeight: CGFloat = 420

    private let model = ShareModel()
    private var height: NSLayoutConstraint?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        model.onClose = { [weak self] kept in self?.finish(kept) }

        // Above the picker the sheet is clear; a tap there closes it.
        let scrim = UIControl()
        scrim.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        scrim.isAccessibilityElement = true
        scrim.accessibilityTraits = .button
        scrim.accessibilityLabel = "Close"

        let host = UIHostingController(rootView: Themed { [model] in ShareBoards(model: model) })
        host.view.backgroundColor = .clear
        addChild(host)
        for v in [scrim, host.view!] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let h = host.view.heightAnchor.constraint(equalToConstant: Self.sheetHeight)
        height = h
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            h,
            scrim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrim.topAnchor.constraint(equalTo: view.topAnchor),
            scrim.bottomAnchor.constraint(equalTo: host.view.topAnchor),
        ])
        host.didMove(toParent: self)

        #if DEBUG
        // No extension context means a preview host, not a real share.
        if extensionContext == nil {
            let d = UserDefaults.standard
            model.demo(d.string(forKey: "shareDemo") ?? "reel", done: d.string(forKey: "shareDone"))
            return
        }
        #endif
        model.load(extensionContext?.inputItems as? [NSExtensionItem] ?? [])
    }

    /// 420pt of picker ABOVE the home indicator; the page colour runs under it.
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        height?.constant = Self.sheetHeight + view.safeAreaInsets.bottom
    }

    /// Swiped away: the same as Close.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        finish(false)
    }

    @objc private func cancel() { finish(false) }

    private func finish(_ kept: Bool) {
        guard !finished else { return }
        finished = true
        if !kept { model.discard() }
        guard let extensionContext else { dismiss(animated: true); return }
        if kept {
            extensionContext.completeRequest(returningItems: nil)
        } else {
            extensionContext.cancelRequest(withError: CocoaError(.userCancelled))
        }
    }
}
