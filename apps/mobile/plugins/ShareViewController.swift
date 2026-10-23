import MobileCoreServices
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  let groupIdentifier = "<GROUPIDENTIFIER>"
  let sharedKey = "<SCHEME>ShareKey"
  var started = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    view.backgroundColor = UIColor.systemBackground
    let message = UILabel()
    message.text = "Saving to bb…"
    message.textAlignment = .center
    message.frame = view.bounds
    message.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(message)
    Task { await saveShare() }
  }

  func saveShare() async {
    var pending: URL?
    do {
      guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let providers = item.attachments, !providers.isEmpty,
            providers.count <= 20,
            let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier)
      else { throw ShareError.invalidShare }
      let identifier = UUID().uuidString
      let inbox = group.appendingPathComponent("bb-share-inbox", isDirectory: true)
      let pendingDirectory = inbox.appendingPathComponent(".\(identifier).pending", isDirectory: true)
      let destination = inbox.appendingPathComponent(identifier, isDirectory: true)
      pending = pendingDirectory
      try FileManager.default.createDirectory(at: pendingDirectory, withIntermediateDirectories: true)
      var files: [[String: Any]] = []
      var texts: [String] = []
      for provider in providers {
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
          let source = try await copyRepresentation(provider, type: UTType.image.identifier)
          let output = pendingDirectory.appendingPathComponent(UUID().uuidString + "." + safeName(source.pathExtension).lowercased())
          try FileManager.default.copyItem(at: source, to: output)
          try? FileManager.default.removeItem(at: source)
          files.append(fileRecord(output, kind: "image"))
        } else if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
          let source = try await copyRepresentation(provider, type: UTType.movie.identifier)
          let output = pendingDirectory.appendingPathComponent(UUID().uuidString + "." + safeName(source.pathExtension).lowercased())
          try FileManager.default.copyItem(at: source, to: output)
          try? FileManager.default.removeItem(at: source)
          files.append(fileRecord(output, kind: "video"))
        } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
          let source = try await copyRepresentation(provider, type: UTType.fileURL.identifier)
          let output = pendingDirectory.appendingPathComponent(safeName(source.lastPathComponent))
          try FileManager.default.copyItem(at: source, to: output)
          try? FileManager.default.removeItem(at: source)
          files.append(fileRecord(output, kind: "file"))
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
          if let url { texts.append(url.absoluteString) }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
          let text = try await provider.loadItem(forTypeIdentifier: UTType.text.identifier) as? String
          if let text { texts.append(text) }
        } else {
          throw ShareError.invalidShare
        }
      }
      guard texts.joined(separator: "\n\n").utf16.count <= 100_000 else { throw ShareError.invalidShare }
      let manifest: [String: Any] = [
        "id": identifier,
        "text": texts.joined(separator: "\n\n"),
        "files": files,
        "createdAt": Date().timeIntervalSince1970,
      ]
      let data = try JSONSerialization.data(withJSONObject: manifest)
      try data.write(to: pendingDirectory.appendingPathComponent("manifest.json"), options: .atomic)
      try FileManager.default.moveItem(at: pendingDirectory, to: destination)
      pending = nil
      UserDefaults(suiteName: groupIdentifier)?.set(identifier, forKey: sharedKey)
      showFinished("Saved to bb. Open bb to choose a project and add it to a draft.")
    } catch {
      if let pending { try? FileManager.default.removeItem(at: pending) }
      showFinished(error.localizedDescription)
    }
  }

  func copyRepresentation(_ provider: NSItemProvider, type: String) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
        if let error { continuation.resume(throwing: error); return }
        guard let url else { continuation.resume(throwing: ShareError.fileUnavailable); return }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
        do {
          try FileManager.default.copyItem(at: url, to: temporary)
          continuation.resume(returning: temporary)
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  func fileRecord(_ url: URL, kind: String) -> [String: Any] {
    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    return ["id": UUID().uuidString, "path": url.lastPathComponent, "fileName": safeName(url.lastPathComponent), "mimeType": mimeType(url.pathExtension), "sizeBytes": size, "kind": kind]
  }

  func mimeType(_ extension: String) -> String {
    guard let type = UTType(filenameExtension: `extension`),
          let mimeType = type.preferredMIMEType else { return "application/octet-stream" }
    return mimeType
  }

  func safeName(_ input: String) -> String {
    let leaf = URL(fileURLWithPath: input).lastPathComponent
    let cleaned = leaf.unicodeScalars.filter { CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- ")).contains($0) }
    return String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in: .whitespacesAndNewlines).prefix(180).description
  }

  func showFinished(_ text: String) {
    DispatchQueue.main.async {
      let alert = UIAlertController(title: "bb", message: text, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Done", style: .default) { _ in
        self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      })
      self.present(alert, animated: true)
    }
  }

  enum ShareError: LocalizedError {
    case invalidShare, fileUnavailable, imageConversion, videoTooLarge
    var errorDescription: String? {
      switch self {
      case .invalidShare: "No shareable content was received."
      case .fileUnavailable: "A shared file could not be read. Try sharing it again."
      case .imageConversion: "The shared image could not be converted. Try sharing it again."
      case .videoTooLarge: "This video is larger than 35 MiB after compression. Choose a shorter video."
      }
    }
  }
}
