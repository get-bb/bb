import AVFoundation
import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers

public final class BBShareInboxModule: Module {
  var groupIdentifier: String { Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String ?? "group.app.getbb.mobile.shared" }

  public func definition() -> ModuleDefinition {
    Name("BBShareInbox")

    AsyncFunction("pendingShares") { () throws -> [[String: Any]] in
      let inbox = try self.inboxURL()
      try self.pruneAcknowledgements()
      let directories = try FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil)
      let expiration = Date().addingTimeInterval(-86_400)
      for directory in directories where directory.lastPathComponent.hasPrefix(".") {
        if let values = try? directory.resourceValues(forKeys: [.contentModificationDateKey]),
           let modified = values.contentModificationDate, modified < expiration {
          try? FileManager.default.removeItem(at: directory)
        }
      }
      var pendingShares: [[String: Any]] = []
      for directory in directories where directory.hasDirectoryPath && !directory.lastPathComponent.hasPrefix(".") && pendingShares.count < 100 {
        guard UUID(uuidString: directory.lastPathComponent) != nil else { continue }
        if try self.readAcknowledgement(directory.lastPathComponent) != nil { continue }
        let manifestURL = directory.appendingPathComponent("manifest.json")
        if let data = try? Data(contentsOf: manifestURL),
           let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let share = try? self.manifestWithUris(manifest, directory: directory) {
          pendingShares.append(share)
        } else {
          let modified = (try? directory.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? Date().timeIntervalSince1970
          pendingShares.append(["id": directory.lastPathComponent, "createdAt": modified, "text": "", "files": [], "error": "This shared item is damaged. Discard it and share again."])
        }
      }
      return pendingShares
    }

    AsyncFunction("getShare") { (identifier: String, profileId: String, serverUrl: String, projectId: String) throws -> [String: Any] in
      if let tombstone = try self.readAcknowledgement(identifier) {
        let claimKey = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
        guard tombstone["activeClaim"] as? String == claimKey else { throw ShareInboxError.claimMismatch }
        guard let claimScopeKey = tombstone["claimScopeKey"] as? String else { throw ShareInboxError.invalidFile }
        return ["id": identifier, "createdAt": tombstone["createdAt"] as? Double ?? Date().timeIntervalSince1970, "text": "", "files": [], "claimScopeKey": claimScopeKey, "alreadyAcknowledged": true]
      }
      let directory = try self.shareDirectory(identifier)
      let manifestURL = directory.appendingPathComponent("manifest.json")
      let data = try Data(contentsOf: manifestURL)
      guard var manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ShareInboxError.invalidFile }
      var claims = manifest["claims"] as? [[String: String]] ?? []
      let claimScopeKey: String
      if let existing = claims.first(where: { $0["profileId"] == profileId && $0["serverUrl"] == serverUrl && $0["projectId"] == projectId }),
         let existingScopeKey = existing["scopeKey"] {
        claimScopeKey = existingScopeKey
      } else {
        claimScopeKey = UUID().uuidString
        claims.append(["profileId": profileId, "serverUrl": serverUrl, "projectId": projectId, "scopeKey": claimScopeKey])
      }
      manifest["claims"] = claims
      manifest["activeClaim"] = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
      try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL, options: .atomic)
      var result = try self.manifestWithUris(manifest, directory: directory)
      result["claimScopeKey"] = claimScopeKey
      return result
    }

    AsyncFunction("recordSharedUpload") { (identifier: String, profileId: String, serverUrl: String, projectId: String, fileId: String, attachment: [String: Any]) throws in
      let directory = try self.shareDirectory(identifier)
      let manifestURL = directory.appendingPathComponent("manifest.json")
      let data = try Data(contentsOf: manifestURL)
      guard var manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let files = manifest["files"] as? [[String: Any]],
            files.contains(where: { $0["id"] as? String == fileId }) else { throw ShareInboxError.invalidFile }
      var receipts = manifest["uploadReceipts"] as? [String: [String: Any]] ?? [:]
      let claims = manifest["claims"] as? [[String: String]] ?? []
      let claimKey = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
      guard manifest["activeClaim"] as? String == claimKey,
            claims.contains(where: { $0["profileId"] == profileId && $0["serverUrl"] == serverUrl && $0["projectId"] == projectId }) else { throw ShareInboxError.claimMismatch }
      let key = [profileId, serverUrl, projectId, fileId].joined(separator: "\u{0}")
      receipts[key] = attachment
      manifest["uploadReceipts"] = receipts
      try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL, options: .atomic)
    }

    AsyncFunction("getSharedUploadReceipt") { (identifier: String, profileId: String, serverUrl: String, projectId: String, fileId: String) throws -> [String: Any]? in
      let directory = try self.shareDirectory(identifier)
      let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
      guard let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ShareInboxError.invalidFile }
      let claims = manifest["claims"] as? [[String: String]] ?? []
      let claimKey = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
      guard manifest["activeClaim"] as? String == claimKey,
            claims.contains(where: { $0["profileId"] == profileId && $0["serverUrl"] == serverUrl && $0["projectId"] == projectId }) else { throw ShareInboxError.claimMismatch }
      let key = [profileId, serverUrl, projectId, fileId].joined(separator: "\u{0}")
      return (manifest["uploadReceipts"] as? [String: [String: Any]])?[key]
    }

    AsyncFunction("acknowledgeShareForProject") { (identifier: String, profileId: String, serverUrl: String, projectId: String) throws in
      if let tombstone = try self.readAcknowledgement(identifier) {
        let claimKey = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
        guard tombstone["activeClaim"] as? String == claimKey else { throw ShareInboxError.claimMismatch }
        return
      }
      let directory = try self.shareDirectory(identifier)
      let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
      guard let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let files = manifest["files"] as? [[String: Any]] else { throw ShareInboxError.invalidFile }
      let claims = manifest["claims"] as? [[String: String]] ?? []
      let claimKey = [profileId, serverUrl, projectId].joined(separator: "\u{0}")
      guard manifest["activeClaim"] as? String == claimKey,
            claims.contains(where: { $0["profileId"] == profileId && $0["serverUrl"] == serverUrl && $0["projectId"] == projectId }) else { throw ShareInboxError.claimMismatch }
      let receipts = manifest["uploadReceipts"] as? [String: [String: Any]] ?? [:]
      let allUploaded = files.allSatisfy { file in
        guard let fileId = file["id"] as? String else { return false }
        return receipts[[profileId, serverUrl, projectId, fileId].joined(separator: "\u{0}")] != nil
      }
      guard allUploaded else { throw ShareInboxError.incompleteUploads }
      guard let scopeKey = claims.first(where: { $0["profileId"] == profileId && $0["serverUrl"] == serverUrl && $0["projectId"] == projectId })?["scopeKey"] else { throw ShareInboxError.claimMismatch }
      try self.writeAcknowledgement(identifier, activeClaim: claimKey, claimScopeKey: scopeKey)
      try FileManager.default.removeItem(at: directory)
    }

    AsyncFunction("prepareShare") { (identifier: String) async throws -> [String: Any] in
      let directory = try self.shareDirectory(identifier)
      let manifestURL = directory.appendingPathComponent("manifest.json")
      guard let data = try? Data(contentsOf: manifestURL),
            var manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            var files = manifest["files"] as? [[String: Any]] else { throw ShareInboxError.invalidIdentifier }
      var originalsToRemove: [URL] = []
      for index in files.indices {
        guard let path = files[index]["path"] as? String,
              URL(fileURLWithPath: path).lastPathComponent == path else { throw ShareInboxError.invalidFile }
        files[index].removeValue(forKey: "processingError")
        let source = try self.validInboxFile(directory.appendingPathComponent(path).absoluteString)
        let kind = files[index]["kind"] as? String
        let mimeType = files[index]["mimeType"] as? String ?? ""
        let size = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        do {
          if kind == "image", (mimeType == "image/heic" || mimeType == "image/heif") {
            let output = try self.convertImage(source)
            files[index]["path"] = output.lastPathComponent
            files[index]["fileName"] = output.lastPathComponent
            files[index]["mimeType"] = "image/jpeg"
            files[index]["sizeBytes"] = (try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            originalsToRemove.append(source)
          } else if kind == "video", size > 35 * 1024 * 1024 {
            let output = try await self.compressVideo(source, directory: directory)
            files[index]["path"] = output.lastPathComponent
            files[index]["fileName"] = output.lastPathComponent
            files[index]["mimeType"] = "video/mp4"
            files[index]["sizeBytes"] = (try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            originalsToRemove.append(source)
          }
        } catch {
          files[index]["processingError"] = error.localizedDescription
        }
      }
      guard let latestData = try? Data(contentsOf: manifestURL),
            var latest = try JSONSerialization.jsonObject(with: latestData) as? [String: Any] else { throw ShareInboxError.invalidFile }
      latest["files"] = files
      try JSONSerialization.data(withJSONObject: latest).write(to: manifestURL, options: .atomic)
      for original in originalsToRemove { try? FileManager.default.removeItem(at: original) }
      return try self.manifestWithUris(latest, directory: directory)
    }

    AsyncFunction("discardShare") { (identifier: String) throws in
      try FileManager.default.removeItem(at: self.shareDirectory(identifier))
    }
  }

  func shareDirectory(_ identifier: String) throws -> URL {
    guard identifier.range(of: "^[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil else {
      throw ShareInboxError.invalidIdentifier
    }
    let directory = try inboxURL().appendingPathComponent(identifier, isDirectory: true)
    let root = try inboxURL().resolvingSymlinksInPath().standardizedFileURL.path + "/"
    let resolved = directory.resolvingSymlinksInPath().standardizedFileURL
    var isDirectory: ObjCBool = false
    guard resolved.path.hasPrefix(root), FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory), isDirectory.boolValue else { throw ShareInboxError.invalidIdentifier }
    return resolved
  }

  func acknowledgementURL(_ identifier: String) throws -> URL {
    guard UUID(uuidString: identifier) != nil else { throw ShareInboxError.invalidIdentifier }
    guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier) else { throw ShareInboxError.groupUnavailable }
    let directory = group.appendingPathComponent("bb-share-acknowledgements", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("\(identifier).json")
  }

  func readAcknowledgement(_ identifier: String) throws -> [String: Any]? {
    let url = try acknowledgementURL(identifier)
    guard let data = try? Data(contentsOf: url) else { return nil }
    guard let tombstone = try JSONSerialization.jsonObject(with: data) as? [String: Any], tombstone["id"] as? String == identifier else { throw ShareInboxError.invalidFile }
    return tombstone
  }

  func writeAcknowledgement(_ identifier: String, activeClaim: String, claimScopeKey: String) throws {
    let tombstone: [String: Any] = ["id": identifier, "activeClaim": activeClaim, "claimScopeKey": claimScopeKey, "createdAt": Date().timeIntervalSince1970]
    try JSONSerialization.data(withJSONObject: tombstone).write(to: acknowledgementURL(identifier), options: .atomic)
  }

  func pruneAcknowledgements() throws {
    let group = try inboxURL().deletingLastPathComponent()
    let directory = group.appendingPathComponent("bb-share-acknowledgements", isDirectory: true)
    guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
    let expiration = Date().addingTimeInterval(-30 * 86_400)
    for entry in entries {
      if let values = try? entry.resourceValues(forKeys: [.contentModificationDateKey]),
         let modified = values.contentModificationDate, modified < expiration {
        try? FileManager.default.removeItem(at: entry)
      }
    }
  }

  func manifestWithUris(_ manifest: [String: Any], directory: URL) throws -> [String: Any] {
    var result = manifest
    guard let records = manifest["files"] as? [[String: Any]], records.count <= 20,
          let text = manifest["text"] as? String, text.utf16.count <= 100_000,
          let identifier = manifest["id"] as? String, identifier == directory.lastPathComponent else { throw ShareInboxError.invalidFile }
    var transformed: [[String: Any]] = []
    for record in records {
      guard let path = record["path"] as? String,
            URL(fileURLWithPath: path).lastPathComponent == path,
            let fileId = record["id"] as? String,
            UUID(uuidString: fileId) != nil else { throw ShareInboxError.invalidFile }
      _ = try validInboxFile(directory.appendingPathComponent(path).absoluteString)
      var item = record
      item["fileId"] = fileId
      item.removeValue(forKey: "id")
      item["uri"] = directory.appendingPathComponent(path).absoluteString
      transformed.append(item)
    }
    result["files"] = transformed
    return result
  }

  func inboxURL() throws -> URL {
    guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier) else {
      throw ShareInboxError.groupUnavailable
    }
    let inbox = group.appendingPathComponent("bb-share-inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
    return inbox
  }

  func validInboxFile(_ path: String) throws -> URL {
    guard let url = URL(string: path), url.isFileURL else { throw ShareInboxError.invalidFile }
    let root = try inboxURL().resolvingSymlinksInPath().standardizedFileURL.path + "/"
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL
    guard resolved.path.hasPrefix(root), FileManager.default.fileExists(atPath: resolved.path) else {
      throw ShareInboxError.invalidFile
    }
    return resolved
  }

  func convertImage(_ sourceURL: URL) throws -> URL {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil),
          let output = CGImageDestinationCreateWithURL(sourceURL.deletingPathExtension().appendingPathExtension("jpg") as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw ShareInboxError.imageConversion
    }
    let destinationURL = sourceURL.deletingPathExtension().appendingPathExtension("jpg")
    let imageProperties = (properties as NSDictionary).mutableCopy() as? NSMutableDictionary ?? NSMutableDictionary()
    imageProperties.removeObject(forKey: kCGImagePropertyGPSDictionary)
    imageProperties[kCGImageDestinationLossyCompressionQuality] = 0.9
    CGImageDestinationAddImage(output, image, imageProperties)
    guard CGImageDestinationFinalize(output) else {
      try? FileManager.default.removeItem(at: destinationURL)
      throw ShareInboxError.imageConversion
    }
    return destinationURL
  }

  func compressVideo(_ source: URL, directory: URL) async throws -> URL {
    let asset = AVURLAsset(url: source)
    for preset in [AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPreset640x480, AVAssetExportPresetLowQuality] {
      let output = directory.appendingPathComponent(UUID().uuidString + ".mp4")
      guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
      session.outputURL = output
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true
      await withCheckedContinuation { continuation in
        session.exportAsynchronously { continuation.resume() }
      }
      if session.status == .completed,
         ((try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? Int.max) <= 35 * 1024 * 1024 {
        return output
      }
      try? FileManager.default.removeItem(at: output)
    }
    throw ShareInboxError.videoTooLarge
  }

  enum ShareInboxError: LocalizedError {
    case groupUnavailable, invalidIdentifier, invalidFile, imageConversion, videoTooLarge, claimMismatch, incompleteUploads
    var errorDescription: String? {
      switch self {
      case .groupUnavailable: "Shared items are unavailable. Rebuild bb with its App Group entitlement."
      case .invalidIdentifier: "The shared item identifier is invalid."
      case .invalidFile: "The shared file is no longer available. Share it again."
      case .imageConversion: "The image could not be converted to JPEG."
      case .videoTooLarge: "This video is larger than 35 MiB after compression. Choose a shorter video or discard this share."
      case .claimMismatch: "This share belongs to a different server or project. Open it again from that destination."
      case .incompleteUploads: "Some shared files have not been added to this draft yet."
      }
    }
  }
}
