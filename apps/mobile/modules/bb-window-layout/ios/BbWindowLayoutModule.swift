import ExpoModulesCore
import UIKit

public final class BbWindowLayoutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BbWindowLayout")
    Constants(["supportsRailExpansion": VerticalBarPreference.supported])
    AsyncFunction("setVerticalBarDisabled") { (disabled: Bool) in
      VerticalBarPreference.setDisabled(disabled)
    }.runOnQueue(.main)
    Function("refreshSafeArea") {
      DispatchQueue.main.async { VerticalBarPreference.refreshSafeArea() }
    }
    View(BbWindowLayoutView.self) {
      Events("onWindowLayout")
    }
  }
}

final class BbWindowLayoutView: ExpoView {
  let onWindowLayout = EventDispatcher()
  private var updateScheduled = false
  private var previousPayload: [String: Any]?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    #if compiler(>=6.4)
    if #available(iOS 27.1, *) {
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
        (view: BbWindowLayoutView, _) in
        view.setNeedsUpdateConstraints()
        view.scheduleUpdate()
      }
    }
    #endif
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(verticalBarPreferenceDidChange),
      name: VerticalBarPreference.didChange,
      object: nil
    )
  }

  @objc private func verticalBarPreferenceDidChange() {
    previousPayload = nil
    setNeedsUpdateConstraints()
    scheduleUpdate()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    previousPayload = nil
    setNeedsUpdateConstraints()
    scheduleUpdate()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    setNeedsUpdateConstraints()
    scheduleUpdate()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scheduleUpdate()
  }

  override func updateConstraints() {
    super.updateConstraints()
    scheduleUpdate()
  }

  private func scheduleUpdate() {
    guard !updateScheduled else { return }
    updateScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.updateScheduled = false
      self.publish()
    }
  }

  private func publish() {
    guard window != nil, bounds.width > 0, bounds.height > 0 else { return }
    var edge = "none"
    var occlusions: [CGRect] = []
    #if compiler(>=6.4)
    if #available(iOS 27.1, *) {
      switch traitCollection.verticalBarEdge {
      case .leading: edge = "leading"
      case .trailing: edge = "trailing"
      default: edge = "none"
      }
      occlusions = reservedRegions(kind: .occlusion).compactMap { region in
        region.isActive ? convert(region.frame, to: nil) : nil
      }
    }
    #endif
    let payload: [String: Any] = [
      "verticalBarEdge": edge,
      "verticalBarBehavior": VerticalBarPreference.disabled ? "disabled" : "automatic",
      "occlusions": occlusions.map(rect)
    ]
    guard !NSDictionary(dictionary: payload).isEqual(to: previousPayload ?? [:]) else { return }
    previousPayload = payload
    onWindowLayout(payload)
  }

  private func rect(_ frame: CGRect) -> [String: CGFloat] {
    ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
  }
}

enum VerticalBarPreference {
  static let didChange = Notification.Name("BbVerticalBarPreferenceDidChange")
  static var supported: Bool {
    #if compiler(>=6.4)
    if #available(iOS 27.1, *) { return true }
    #endif
    return false
  }
  private(set) static var disabled = false
  private static var installed = false

  static func setDisabled(_ value: Bool) {
    guard value != disabled else { return }
    disabled = value
    apply()
  }

  static func refreshSafeArea() {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows {
        guard let root = window.rootViewController else { continue }
        let original = root.additionalSafeAreaInsets
        var nudged = original
        nudged.bottom += 1
        root.additionalSafeAreaInsets = nudged
        root.view.layoutIfNeeded()
        root.additionalSafeAreaInsets = original
        root.view.setNeedsLayout()
      }
    }
  }

  private static func apply() {
    #if compiler(>=6.4)
    if #available(iOS 27.1, *) {
      install()
      for scene in UIApplication.shared.connectedScenes {
        guard let windowScene = scene as? UIWindowScene else { continue }
        for window in windowScene.windows {
          window.rootViewController?.setNeedsUpdateOfVerticalBarConfiguration()
        }
      }
    }
    #endif
    NotificationCenter.default.post(name: didChange, object: nil)
  }

  #if compiler(>=6.4)
  @available(iOS 27.1, *)
  private static func install() {
    guard !installed else { return }
    installed = true
    let selector = #selector(getter: UIViewController.preferredVerticalBarBehavior)
    guard let method = class_getInstanceMethod(UIViewController.self, selector) else { return }
    typealias Getter = @convention(c) (UIViewController, Selector) -> UIVerticalBarBehavior
    let original = unsafeBitCast(method_getImplementation(method), to: Getter.self)
    let replacement: @convention(block) (UIViewController) -> UIVerticalBarBehavior = { controller in
      if disabled, let window = controller.viewIfLoaded?.window, window.rootViewController === controller {
        return .disabled
      }
      return original(controller, selector)
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }
  #endif
}
