import CryptoKit
import Foundation

/**
 * AES-256-GCM sealing for the encrypted pending-capture store.
 *
 * CommonCrypto's public headers no longer declare a GCM API on current
 * SDKs (no `CCCryptorGCMOneshotEncrypt`/`Decrypt`, no `kCCModeGCM`), and
 * CryptoKit has no Objective-C interface, so this bridges it for
 * DpdpGuardOffline.mm. `AES.GCM.SealedBox.combined` is `nonce(12) ||
 * ciphertext || tag(16)`, matching the on-disk layout the Obj-C++ side
 * already expects.
 */
@objc(DpdpGuardOfflineCrypto)
public final class DpdpGuardOfflineCrypto: NSObject {
  @objc public static func seal(_ plaintext: Data, key: Data) -> Data? {
    guard let sealedBox = try? AES.GCM.seal(plaintext, using: SymmetricKey(data: key)) else {
      return nil
    }
    return sealedBox.combined
  }

  @objc public static func open(_ sealed: Data, key: Data) -> Data? {
    guard let sealedBox = try? AES.GCM.SealedBox(combined: sealed) else { return nil }
    return try? AES.GCM.open(sealedBox, using: SymmetricKey(data: key))
  }
}
