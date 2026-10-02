// ShareViewController.swift — placeholder so the target builds; the real
// picker replaces it (see PLAN.md, "Share extension").
import UIKit

final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        extensionContext?.completeRequest(returningItems: nil)
    }
}
