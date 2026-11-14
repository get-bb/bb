import ExpoModulesCore
import ObjectiveC
import UIKit

public final class BbKeyboardHingeGuardSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    KeyboardHingeGuard.install()
    return true
  }
}

enum KeyboardHingeGuard {
  private static var installed = false
  private static var movingToWindow = 0

  static func install() {
    guard !installed else { return }
    installed = true
    guard
      let star = NSClassFromString("UIKeyboardLayoutStar"),
      let move = ownMethod(star, "didMoveToWindow", encoding: "v16@0:8"),
      let update = ownMethod(star, "_updateSplitForDivisionRegions:", encoding: "v20@0:8B16")
    else { return }

    typealias Move = @convention(c) (AnyObject, Selector) -> Void
    typealias Update = @convention(c) (AnyObject, Selector, Bool) -> Void
    let moveSelector = method_getName(move)
    let updateSelector = method_getName(update)
    let originalMove = unsafeBitCast(method_getImplementation(move), to: Move.self)
    let originalUpdate = unsafeBitCast(method_getImplementation(update), to: Update.self)

    let moveReplacement: @convention(block) (AnyObject) -> Void = { keyboard in
      movingToWindow += 1
      defer { movingToWindow -= 1 }
      originalMove(keyboard, moveSelector)
    }
    let updateReplacement: @convention(block) (AnyObject, Bool) -> Void = { keyboard, value in
      guard movingToWindow > 0 else {
        originalUpdate(keyboard, updateSelector, value)
        return
      }
      DispatchQueue.main.async { [weak keyboard] in
        guard let keyboard = keyboard as? UIView, keyboard.window != nil else { return }
        originalUpdate(keyboard, updateSelector, value)
      }
    }
    method_setImplementation(move, imp_implementationWithBlock(moveReplacement))
    method_setImplementation(update, imp_implementationWithBlock(updateReplacement))
  }

  private static func ownMethod(_ cls: AnyClass, _ name: String, encoding: String) -> Method? {
    let selector = NSSelectorFromString(name)
    var count: UInt32 = 0
    guard let list = class_copyMethodList(cls, &count) else { return nil }
    defer { free(list) }
    for index in 0..<Int(count) where method_getName(list[index]) == selector {
      guard
        let types = method_getTypeEncoding(list[index]),
        String(cString: types) == encoding
      else { return nil }
      return list[index]
    }
    return nil
  }
}
