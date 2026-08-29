package ai.dpdpguard.offline

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Secure-element key storage, ECDSA P-256 signing, and an encrypted local
 * queue for offline consent capture (docs/specs/offline-consent-capture.md
 * §4).
 *
 * Deliberately narrow: this module never builds the `dpdpcca/2` canonical
 * string. That lives in JavaScript (src/offline/captureArtifact.ts), tested
 * against the contract's golden vectors, so there is exactly one
 * implementation of the bytes a signature commits to — a second one here
 * could drift, and drift means a legitimate consent quarantining as
 * `signature_mismatch`.
 */
@ReactModule(name = DpdpGuardOfflineModule.NAME)
class DpdpGuardOfflineModule(reactContext: ReactApplicationContext) :
  NativeDpdpGuardOfflineSpec(reactContext) {

  companion object {
    const val NAME = "DpdpGuardOffline"

    private const val KEYSTORE = "AndroidKeyStore"
    private const val SIGNING_KEY_ALIAS = "ai.dpdpguard.offline.signing-key"
    private const val STORE_KEY_ALIAS = "ai.dpdpguard.offline.store-key"
    private const val STORE_DIRECTORY = "dpdpguard-offline-captures"
    private const val SESSION_EXTENSION = ".dpdpcap"

    /** AES-GCM nonce length, in bytes. */
    private const val NONCE_LENGTH = 12
    private const val TAG_BITS = 128
  }

  override fun getName(): String = NAME

  private val keyStore: KeyStore by lazy {
    KeyStore.getInstance(KEYSTORE).apply { load(null) }
  }

  private val storeDirectory: File by lazy {
    // filesDir, not cacheDir or external storage: pending captures hold PII
    // and are evidence of a legal event, so they must not be evictable by
    // the OS or readable by another app.
    File(reactApplicationContext.filesDir, STORE_DIRECTORY).apply { mkdirs() }
  }

  // --- Signing key ---------------------------------------------------------

  private fun signingKeyEntry(): KeyStore.PrivateKeyEntry {
    (keyStore.getEntry(SIGNING_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry)?.let {
      return it
    }

    val spec = KeyGenParameterSpec.Builder(
      SIGNING_KEY_ALIAS,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
    )
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      // No setUserAuthenticationRequired: a field agent captures consent for
      // someone else, often on a shared device, so gating each signature on
      // the agent's biometric would block the capture the spec requires to
      // work at zero bars and with no interaction beyond the notice itself.
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          // StrongBox where the hardware has it; fall through below if not.
          setIsStrongBoxBacked(true)
        }
      }
      .build()

    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC,
      KEYSTORE,
    )

    try {
      generator.initialize(spec)
      generator.generateKeyPair()
    } catch (strongBoxUnavailable: Exception) {
      // StrongBoxUnavailableException on devices without a dedicated secure
      // element. Retry against the TEE: a TEE-held key is still non-
      // exportable, and isHardwareBacked() reports what was actually used.
      val fallback = KeyGenParameterSpec.Builder(
        SIGNING_KEY_ALIAS,
        KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
      )
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build()
      generator.initialize(fallback)
      generator.generateKeyPair()
    }

    return keyStore.getEntry(SIGNING_KEY_ALIAS, null) as KeyStore.PrivateKeyEntry
  }

  override fun enrollDevice(promise: Promise) {
    try {
      val entry = signingKeyEntry()
      // getEncoded() on an EC public key is already SPKI DER, exactly what
      // agentDevices.publicKey stores.
      val spki = entry.certificate.publicKey.encoded
      promise.resolve(Base64.encodeToString(spki, Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("enroll_failed", "Could not create the device signing key.", error)
    }
  }

  override fun getPublicKey(promise: Promise) {
    try {
      val entry = keyStore.getEntry(SIGNING_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
      if (entry == null) {
        promise.resolve(null)
        return
      }
      val spki = entry.certificate.publicKey.encoded
      promise.resolve(Base64.encodeToString(spki, Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("keystore_failed", "Could not read the device signing key.", error)
    }
  }

  override fun isHardwareBacked(promise: Promise) {
    try {
      val entry = keyStore.getEntry(SIGNING_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
      if (entry == null) {
        promise.resolve(false)
        return
      }

      val privateKey: PrivateKey = entry.privateKey
      val factory = KeyFactory.getInstance(privateKey.algorithm, KEYSTORE)
      val info = factory.getKeySpec(privateKey, KeyInfo::class.java)

      val backed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
          info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
      } else {
        @Suppress("DEPRECATION")
        info.isInsideSecureHardware
      }
      promise.resolve(backed)
    } catch (error: Exception) {
      promise.resolve(false)
    }
  }

  override fun sign(canonical: String, promise: Promise) {
    try {
      val entry = signingKeyEntry()
      val signature = Signature.getInstance("SHA256withECDSA").apply {
        initSign(entry.privateKey)
        update(canonical.toByteArray(Charsets.UTF_8))
      }
      val der = signature.sign()
      val p1363 = p1363FromDer(der)
        ?: throw IllegalStateException("Signature was not valid X9.62 DER.")
      promise.resolve(Base64.encodeToString(p1363, Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("sign_failed", "The device refused to sign the capture.", error)
    }
  }

  /**
   * Converts the X9.62 DER signature the JCA returns into the raw
   * IEEE-P1363 `r || s` pair the server verifies. Both integers are
   * left-padded to exactly 32 bytes: DER strips leading zeroes and may add
   * a padding byte, so neither is a fixed width on the wire.
   */
  private fun p1363FromDer(der: ByteArray): ByteArray? {
    if (der.size < 8 || der[0] != 0x30.toByte()) return null

    var index = 1
    // Skip the (possibly long-form) sequence length.
    index += if (der[index].toInt() and 0x80 != 0) {
      1 + (der[index].toInt() and 0x7f)
    } else {
      1
    }

    val out = ByteArray(64)
    for (half in 0..1) {
      if (index >= der.size || der[index] != 0x02.toByte()) return null
      index++
      if (index >= der.size) return null

      var intLength = der[index].toInt() and 0xff
      index++
      if (intLength == 0 || index + intLength > der.size) return null

      var start = index
      index += intLength // Advance by the declared length, before trimming.

      while (intLength > 1 && der[start] == 0x00.toByte()) {
        start++
        intLength--
      }
      if (intLength > 32) return null

      System.arraycopy(der, start, out, half * 32 + (32 - intLength), intLength)
    }
    return out
  }

  // --- Encrypted store -----------------------------------------------------

  private fun storeKey(): SecretKey {
    (keyStore.getEntry(STORE_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
      return it.secretKey
    }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        STORE_KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  /** On-disk layout is `nonce(12) || ciphertext || tag(16)`. */
  private fun seal(plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, storeKey())
    val sealed = cipher.doFinal(plaintext)
    return cipher.iv + sealed
  }

  private fun open(sealed: ByteArray): ByteArray? = try {
    if (sealed.size <= NONCE_LENGTH) {
      null
    } else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        storeKey(),
        GCMParameterSpec(TAG_BITS, sealed, 0, NONCE_LENGTH),
      )
      cipher.doFinal(sealed, NONCE_LENGTH, sealed.size - NONCE_LENGTH)
    }
  } catch (corrupt: Exception) {
    null
  }

  /** clientSessionId is client-supplied; keep it out of the path. */
  private fun fileFor(clientSessionId: String): File {
    val safeName = Base64.encodeToString(
      clientSessionId.toByteArray(Charsets.UTF_8),
      Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING,
    )
    return File(storeDirectory, safeName + SESSION_EXTENSION)
  }

  override fun saveSession(clientSessionId: String, sessionJson: String, promise: Promise) {
    try {
      fileFor(clientSessionId).writeBytes(seal(sessionJson.toByteArray(Charsets.UTF_8)))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("store_failed", "Could not persist the capture.", error)
    }
  }

  override fun loadPendingSessions(promise: Promise) {
    try {
      val sessions = com.facebook.react.bridge.Arguments.createArray()
      storeDirectory.listFiles()
        ?.filter { it.name.endsWith(SESSION_EXTENSION) }
        ?.forEach { file ->
          // A file that will not open is corrupt or was written under a key
          // that no longer exists. Skip it rather than failing the whole
          // drain — the sessions that can still sync are evidence too.
          val plaintext = open(file.readBytes()) ?: return@forEach
          sessions.pushString(String(plaintext, Charsets.UTF_8))
        }
      promise.resolve(sessions)
    } catch (error: Exception) {
      promise.reject("store_failed", "Could not read pending captures.", error)
    }
  }

  override fun removeSession(clientSessionId: String, promise: Promise) {
    fileFor(clientSessionId).delete()
    promise.resolve(null)
  }

  override fun removeAllSessions(promise: Promise) {
    storeDirectory.listFiles()
      ?.filter { it.name.endsWith(SESSION_EXTENSION) }
      ?.forEach { it.delete() }
    promise.resolve(null)
  }
}
