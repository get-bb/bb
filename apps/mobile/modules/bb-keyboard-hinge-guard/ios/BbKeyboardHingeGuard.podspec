Pod::Spec.new do |s|
  s.name = 'BbKeyboardHingeGuard'
  s.version = '0.1.0'
  s.summary = 'Keeps the iOS keyboard from splitting around the iPhone Duo hinge in split screen'
  s.description = 'Skips UIKit split-keyboard division updates when the app window is narrower than its screen, where UIKit crashes in Auto Layout'
  s.license = 'Apache-2.0'
  s.author = 'bb'
  s.homepage = 'https://getbb.app'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
