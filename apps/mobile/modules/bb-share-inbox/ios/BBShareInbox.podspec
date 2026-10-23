Pod::Spec.new do |s|
  s.name           = 'BBShareInbox'
  s.version        = '1.0.0'
  s.summary        = 'Durable iOS share inbox for bb'
  s.description    = 'Reads and prepares files staged by the bb iOS share extension.'
  s.license        = { :type => 'MIT' }
  s.author         = 'bb'
  s.homepage       = 'https://getbb.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://getbb.app', :tag => s.version.to_s }
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
end
