import UIKit
import UniformTypeIdentifiers

// "OpenCollab" in the iOS Share sheet. It turns what was shared (a link, text,
// or both) into the same opencollab://share?text=…&subject=… link Android's
// share target produces, opens the app with it and closes. The app's board
// picker, link preview and Shared items list take it from there.
final class ShareViewController: UIViewController {
  private var started = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    Task { await handOff() }
  }

  private func handOff() async {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    var link: String?
    var text: String?
    for provider in items.flatMap({ $0.attachments ?? [] }) {
      if link == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
        !url.isFileURL
      {
        link = url.absoluteString
      } else if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
        let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
          as? String
      {
        text = value
      }
    }
    // Some apps send the page title or a comment alongside the link.
    let note = items.first?.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines)
    var shared = text ?? ""
    if let link, !shared.contains(link) { shared = shared.isEmpty ? link : "\(shared) \(link)" }
    if shared.isEmpty, let note { shared = note }

    if !shared.isEmpty, let url = shareLink(text: shared, subject: note == shared ? nil : note),
      open(url)
    {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }
    let alert = UIAlertController(
      title: "Couldn't open OpenCollab",
      message: shared.isEmpty
        ? "There was nothing to add: share a link or text."
        : "Open OpenCollab and try sharing again.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
      self?.extensionContext?.completeRequest(returningItems: nil)
    })
    present(alert, animated: true)
  }

  // Everything but letters and digits is percent-encoded: the app decodes "+"
  // as a space, so it must not survive unencoded.
  private func shareLink(text: String, subject: String?) -> URL? {
    let encode = { (value: String) in
      value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }
    var query = "text=\(encode(text))"
    if let subject, !subject.isEmpty { query += "&subject=\(encode(subject))" }
    return URL(string: "opencollab://share?\(query)")
  }

  // Extensions can't call UIApplication.shared; the app object is still on the
  // responder chain. open(_:options:completionHandler:) is called through the
  // runtime because it is marked unavailable to extensions at compile time.
  private func open(_ url: URL) -> Bool {
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication, application.responds(to: selector) {
        typealias Open = @convention(c) (
          AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?
        ) -> Void
        let call = unsafeBitCast(application.method(for: selector), to: Open.self)
        call(application, selector, url as NSURL, NSDictionary(), nil)
        return true
      }
      responder = current.next
    }
    return false
  }
}
