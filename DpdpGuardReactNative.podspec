require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DpdpGuardReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/dpdp-guard-ai/dpdpguard-react-native-sdk.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  # Secure Enclave key generation and ECDSA signing; CryptoKit (via a Swift
  # shim, DpdpGuardOfflineCrypto) for the AES-GCM sealing of the
  # pending-capture store -- CommonCrypto's public headers have no GCM API
  # on current SDKs.
  s.frameworks   = "Security"

  # Swift's ClangImporter builds this pod's umbrella module in plain
  # Objective-C mode by default, but DpdpGuardOffline.h pulls in the
  # TurboModule codegen header (DpdpGuardOfflineSpec.h), which is C++ and
  # refuses to compile outside Objective-C++. objcxx interop mode makes
  # Swift import it as such instead of tripping that guard.
  s.pod_target_xcconfig = {
    "SWIFT_OBJC_INTEROP_MODE" => "objcxx"
  }

  install_modules_dependencies(s)
end
