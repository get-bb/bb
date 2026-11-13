Pod::Spec.new do |s|
  s.name = 'BbWindowLayout'
  s.version = '0.1.0'
  s.summary = 'Window layout for bb: the folded iPhone vertical bar and system occlusions'
  s.description = 'Turns the iPhone vertical bar off on request and reports its edge, behavior and the window occlusions'
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
