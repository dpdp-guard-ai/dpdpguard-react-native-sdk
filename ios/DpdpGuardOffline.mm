#import "DpdpGuardOffline.h"

#import <CommonCrypto/CommonCrypto.h>
#import <Security/Security.h>

static NSString *const kSigningKeyTag = @"ai.dpdpguard.offline.signing-key";
static NSString *const kStoreKeyAccount = @"ai.dpdpguard.offline.store-key";
static NSString *const kStoreKeyService = @"ai.dpdpguard.offline";
static NSString *const kErrorDomain = @"DpdpGuardOffline";
static NSString *const kSessionFileExtension = @"dpdpcap";

/**
 * The fixed ASN.1 SubjectPublicKeyInfo header for an uncompressed
 * secp256r1 public key. `SecKeyCopyExternalRepresentation` hands back the
 * bare ANSI X9.63 point (0x04 || X || Y), but `agentDevices.publicKey`
 * stores base64 SPKI DER, so the header is prepended here rather than
 * being reconstructed by every caller.
 */
static const uint8_t kP256SPKIHeader[] = {
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00};

@implementation DpdpGuardOffline {
  BOOL _hardwareBacked;
}

RCT_EXPORT_MODULE()

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDpdpGuardOfflineSpecJSI>(params);
}

#pragma mark - Errors

static NSError *DpdpError(NSInteger code, NSString *message) {
  return [NSError errorWithDomain:kErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

#pragma mark - Signing key

/** The Secure Enclave key if this device has one, else a Keychain key. */
- (SecKeyRef)copySigningKeyCreatingIfNeeded:(NSError **)error {
  NSData *tag = [kSigningKeyTag dataUsingEncoding:NSUTF8StringEncoding];

  NSDictionary *query = @{
    (id)kSecClass : (id)kSecClassKey,
    (id)kSecAttrApplicationTag : tag,
    (id)kSecAttrKeyType : (id)kSecAttrKeyTypeECSECPrimeRandom,
    (id)kSecReturnRef : @YES,
  };

  SecKeyRef existing = NULL;
  OSStatus status =
      SecItemCopyMatching((__bridge CFDictionaryRef)query, (CFTypeRef *)&existing);
  if (status == errSecSuccess && existing != NULL) {
    return existing;
  }

  // Secure Enclave where available; a Keychain-held software key otherwise
  // (Simulator, and hardware without an enclave). The distinction is
  // reported by isHardwareBacked so a host app can refuse offline capture
  // on a device whose key is only software-protected — the server cannot
  // tell the two apart from a signature.
  BOOL useSecureEnclave = NO;
#if !TARGET_OS_SIMULATOR
  useSecureEnclave = YES;
#endif

  CFErrorRef accessError = NULL;
  SecAccessControlRef access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      useSecureEnclave ? kSecAccessControlPrivateKeyUsage : 0, &accessError);
  if (access == NULL) {
    if (error != NULL) {
      *error = DpdpError(1, @"Could not create key access control.");
    }
    if (accessError) CFRelease(accessError);
    return NULL;
  }

  NSMutableDictionary *keyAttributes = [@{
    (id)kSecAttrKeyType : (id)kSecAttrKeyTypeECSECPrimeRandom,
    (id)kSecAttrKeySizeInBits : @256,
    (id)kSecPrivateKeyAttrs : @{
      (id)kSecAttrIsPermanent : @YES,
      (id)kSecAttrApplicationTag : tag,
      (id)kSecAttrAccessControl : (__bridge id)access,
    },
  } mutableCopy];

  if (useSecureEnclave) {
    keyAttributes[(id)kSecAttrTokenID] = (id)kSecAttrTokenIDSecureEnclave;
  }

  CFErrorRef createError = NULL;
  SecKeyRef privateKey = SecKeyCreateRandomKey(
      (__bridge CFDictionaryRef)keyAttributes, &createError);
  CFRelease(access);

  if (privateKey == NULL) {
    // Fall back to a software key if the enclave refused (some hardware
    // and configurations do). Better a software-backed capture, correctly
    // reported as such, than no capture at all.
    if (useSecureEnclave) {
      if (createError) CFRelease(createError);
      keyAttributes[(id)kSecAttrTokenID] = nil;
      createError = NULL;
      privateKey = SecKeyCreateRandomKey(
          (__bridge CFDictionaryRef)keyAttributes, &createError);
    }
    if (privateKey == NULL) {
      if (error != NULL) {
        *error = DpdpError(2, @"Could not create the device signing key.");
      }
      if (createError) CFRelease(createError);
      return NULL;
    }
    _hardwareBacked = NO;
  } else {
    _hardwareBacked = useSecureEnclave;
  }

  if (createError) CFRelease(createError);
  return privateKey;
}

- (NSString *)copyPublicKeySPKIBase64:(SecKeyRef)privateKey error:(NSError **)error {
  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  if (publicKey == NULL) {
    if (error != NULL) *error = DpdpError(3, @"Could not derive the public key.");
    return nil;
  }

  CFErrorRef exportError = NULL;
  CFDataRef raw = SecKeyCopyExternalRepresentation(publicKey, &exportError);
  CFRelease(publicKey);
  if (raw == NULL) {
    if (error != NULL) *error = DpdpError(4, @"Could not export the public key.");
    if (exportError) CFRelease(exportError);
    return nil;
  }

  NSMutableData *spki =
      [NSMutableData dataWithBytes:kP256SPKIHeader length:sizeof(kP256SPKIHeader)];
  [spki appendData:(__bridge NSData *)raw];
  CFRelease(raw);

  return [spki base64EncodedStringWithOptions:0];
}

#pragma mark - Signature encoding

/**
 * Converts the X9.62 DER signature Security.framework returns into the raw
 * IEEE-P1363 `r || s` pair the server verifies. Both integers are
 * left-padded to exactly 32 bytes; DER strips leading zeroes and may add a
 * padding byte, so neither is a fixed width on the wire.
 */
static NSData *P1363FromDER(NSData *der) {
  const uint8_t *bytes = (const uint8_t *)der.bytes;
  NSUInteger length = der.length;
  if (length < 8 || bytes[0] != 0x30) return nil;

  NSUInteger index = 1;
  // Skip the (possibly long-form) sequence length.
  if (bytes[index] & 0x80) {
    NSUInteger lengthBytes = bytes[index] & 0x7f;
    index += 1 + lengthBytes;
  } else {
    index += 1;
  }

  uint8_t out[64] = {0};
  for (int half = 0; half < 2; half++) {
    if (index >= length || bytes[index] != 0x02) return nil;
    index++;
    if (index >= length) return nil;

    NSUInteger intLength = bytes[index];
    index++;
    if (intLength == 0 || index + intLength > length) return nil;

    const uint8_t *value = bytes + index;
    index += intLength;  // Advance by the *declared* length, before trimming.

    // DER encodes a leading 0x00 to keep the integer positive; P1363 wants
    // a fixed 32-byte big-endian field, so strip it and left-pad instead.
    while (intLength > 1 && *value == 0x00) {
      value++;
      intLength--;
    }
    if (intLength > 32) return nil;

    memcpy(out + half * 32 + (32 - intLength), value, intLength);
  }

  return [NSData dataWithBytes:out length:sizeof(out)];
}

#pragma mark - Encrypted store

- (NSURL *)storeDirectory:(NSError **)error {
  NSURL *support = [[NSFileManager defaultManager] URLForDirectory:NSApplicationSupportDirectory
                                                          inDomain:NSUserDomainMask
                                                 appropriateForURL:nil
                                                            create:YES
                                                             error:error];
  if (support == nil) return nil;

  NSURL *directory = [support URLByAppendingPathComponent:@"DpdpGuardOfflineCaptures"
                                              isDirectory:YES];
  if (![[NSFileManager defaultManager] fileExistsAtPath:directory.path]) {
    if (![[NSFileManager defaultManager] createDirectoryAtURL:directory
                                 withIntermediateDirectories:YES
                                                  attributes:nil
                                                       error:error]) {
      return nil;
    }
  }

  // Pending captures hold PII and are evidence of a legal event, not
  // cacheable state — they must not ride along into a device or iCloud
  // backup where their retention window no longer applies.
  NSURL *mutableDirectory = directory;
  [mutableDirectory setResourceValue:@YES
                              forKey:NSURLIsExcludedFromBackupKey
                               error:NULL];

  return directory;
}

/** A device-only AES-256 key for the store, created on first use. */
- (NSData *)storeKey:(NSError **)error {
  NSDictionary *query = @{
    (id)kSecClass : (id)kSecClassGenericPassword,
    (id)kSecAttrService : kStoreKeyService,
    (id)kSecAttrAccount : kStoreKeyAccount,
    (id)kSecReturnData : @YES,
  };

  CFDataRef existing = NULL;
  OSStatus status =
      SecItemCopyMatching((__bridge CFDictionaryRef)query, (CFTypeRef *)&existing);
  if (status == errSecSuccess && existing != NULL) {
    return (__bridge_transfer NSData *)existing;
  }

  NSMutableData *key = [NSMutableData dataWithLength:32];
  if (SecRandomCopyBytes(kSecRandomDefault, 32, key.mutableBytes) != errSecSuccess) {
    if (error != NULL) *error = DpdpError(5, @"Could not generate a store key.");
    return nil;
  }

  NSDictionary *add = @{
    (id)kSecClass : (id)kSecClassGenericPassword,
    (id)kSecAttrService : kStoreKeyService,
    (id)kSecAttrAccount : kStoreKeyAccount,
    (id)kSecValueData : key,
    (id)kSecAttrAccessible : (id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  };
  if (SecItemAdd((__bridge CFDictionaryRef)add, NULL) != errSecSuccess) {
    if (error != NULL) *error = DpdpError(6, @"Could not persist the store key.");
    return nil;
  }
  return key;
}

/** AES-256-GCM. Layout on disk is `nonce(12) || ciphertext || tag(16)`. */
static NSData *SealSession(NSData *plaintext, NSData *key) {
  NSMutableData *nonce = [NSMutableData dataWithLength:12];
  if (SecRandomCopyBytes(kSecRandomDefault, 12, nonce.mutableBytes) != errSecSuccess) {
    return nil;
  }

  NSMutableData *ciphertext = [NSMutableData dataWithLength:plaintext.length];
  NSMutableData *tag = [NSMutableData dataWithLength:16];

  CCCryptorStatus status = CCCryptorGCMOneshotEncrypt(
      kCCAlgorithmAES, key.bytes, key.length, nonce.bytes, nonce.length, NULL, 0,
      plaintext.bytes, plaintext.length, ciphertext.mutableBytes,
      tag.mutableBytes, tag.length);
  if (status != kCCSuccess) return nil;

  NSMutableData *sealed = [NSMutableData dataWithData:nonce];
  [sealed appendData:ciphertext];
  [sealed appendData:tag];
  return sealed;
}

static NSData *OpenSession(NSData *sealed, NSData *key) {
  if (sealed.length < 12 + 16) return nil;

  NSData *nonce = [sealed subdataWithRange:NSMakeRange(0, 12)];
  NSUInteger ciphertextLength = sealed.length - 12 - 16;
  NSData *ciphertext = [sealed subdataWithRange:NSMakeRange(12, ciphertextLength)];
  NSData *tag = [sealed subdataWithRange:NSMakeRange(12 + ciphertextLength, 16)];

  NSMutableData *plaintext = [NSMutableData dataWithLength:ciphertextLength];
  NSMutableData *computedTag = [NSMutableData dataWithData:tag];

  CCCryptorStatus status = CCCryptorGCMOneshotDecrypt(
      kCCAlgorithmAES, key.bytes, key.length, nonce.bytes, nonce.length, NULL, 0,
      ciphertext.bytes, ciphertext.length, plaintext.mutableBytes,
      computedTag.bytes, computedTag.length);
  if (status != kCCSuccess) return nil;

  return plaintext;
}

- (NSURL *)fileForSession:(NSString *)clientSessionId error:(NSError **)error {
  NSURL *directory = [self storeDirectory:error];
  if (directory == nil) return nil;

  // clientSessionId is a client-supplied string; keep it out of the path.
  NSString *safeName = [[clientSessionId dataUsingEncoding:NSUTF8StringEncoding]
      base64EncodedStringWithOptions:0];
  safeName = [[safeName stringByReplacingOccurrencesOfString:@"/" withString:@"_"]
      stringByReplacingOccurrencesOfString:@"+"
                                withString:@"-"];

  return [directory URLByAppendingPathComponent:
                        [NSString stringWithFormat:@"%@.%@", safeName,
                                                   kSessionFileExtension]];
}

#pragma mark - NativeDpdpGuardOfflineSpec

- (void)enrollDevice:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  SecKeyRef key = [self copySigningKeyCreatingIfNeeded:&error];
  if (key == NULL) {
    reject(@"enroll_failed", error.localizedDescription, error);
    return;
  }

  NSString *publicKey = [self copyPublicKeySPKIBase64:key error:&error];
  CFRelease(key);

  if (publicKey == nil) {
    reject(@"enroll_failed", error.localizedDescription, error);
    return;
  }
  resolve(publicKey);
}

- (void)getPublicKey:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  NSData *tag = [kSigningKeyTag dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *query = @{
    (id)kSecClass : (id)kSecClassKey,
    (id)kSecAttrApplicationTag : tag,
    (id)kSecAttrKeyType : (id)kSecAttrKeyTypeECSECPrimeRandom,
    (id)kSecReturnRef : @YES,
  };

  SecKeyRef key = NULL;
  if (SecItemCopyMatching((__bridge CFDictionaryRef)query, (CFTypeRef *)&key) !=
          errSecSuccess ||
      key == NULL) {
    resolve(nil);
    return;
  }

  NSError *error = nil;
  NSString *publicKey = [self copyPublicKeySPKIBase64:key error:&error];
  CFRelease(key);
  resolve(publicKey);
}

- (void)isHardwareBacked:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
#if TARGET_OS_SIMULATOR
  resolve(@NO);
#else
  resolve(@(_hardwareBacked));
#endif
}

- (void)sign:(NSString *)canonical
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  SecKeyRef key = [self copySigningKeyCreatingIfNeeded:&error];
  if (key == NULL) {
    reject(@"sign_failed", error.localizedDescription, error);
    return;
  }

  NSData *message = [canonical dataUsingEncoding:NSUTF8StringEncoding];
  CFErrorRef signError = NULL;
  CFDataRef der = SecKeyCreateSignature(
      key, kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
      (__bridge CFDataRef)message, &signError);
  CFRelease(key);

  if (der == NULL) {
    reject(@"sign_failed", @"The device refused to sign the capture.", nil);
    if (signError) CFRelease(signError);
    return;
  }

  NSData *p1363 = P1363FromDER((__bridge NSData *)der);
  CFRelease(der);

  if (p1363 == nil) {
    reject(@"sign_failed", @"Could not re-encode the signature as IEEE-P1363.", nil);
    return;
  }
  resolve([p1363 base64EncodedStringWithOptions:0]);
}

- (void)saveSession:(NSString *)clientSessionId
        sessionJson:(NSString *)sessionJson
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  NSData *key = [self storeKey:&error];
  NSURL *file = [self fileForSession:clientSessionId error:&error];
  if (key == nil || file == nil) {
    reject(@"store_failed", error.localizedDescription ?: @"Store unavailable.", error);
    return;
  }

  NSData *sealed = SealSession([sessionJson dataUsingEncoding:NSUTF8StringEncoding], key);
  if (sealed == nil) {
    reject(@"store_failed", @"Could not encrypt the capture.", nil);
    return;
  }

  if (![sealed writeToURL:file options:NSDataWritingAtomic error:&error]) {
    reject(@"store_failed", error.localizedDescription, error);
    return;
  }
  resolve(nil);
}

- (void)loadPendingSessions:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  NSURL *directory = [self storeDirectory:&error];
  NSData *key = [self storeKey:&error];
  if (directory == nil || key == nil) {
    resolve(@[]);
    return;
  }

  NSArray<NSURL *> *files =
      [[NSFileManager defaultManager] contentsOfDirectoryAtURL:directory
                                   includingPropertiesForKeys:nil
                                                      options:0
                                                        error:&error];
  NSMutableArray<NSString *> *sessions = [NSMutableArray array];
  for (NSURL *file in files) {
    if (![file.pathExtension isEqualToString:kSessionFileExtension]) continue;

    NSData *sealed = [NSData dataWithContentsOfURL:file];
    if (sealed == nil) continue;

    NSData *plaintext = OpenSession(sealed, key);
    // A file that will not open is corrupt or was written under a key that
    // no longer exists. Skip it rather than failing the whole drain — the
    // sessions that can still sync are evidence too.
    if (plaintext == nil) continue;

    NSString *json = [[NSString alloc] initWithData:plaintext
                                           encoding:NSUTF8StringEncoding];
    if (json != nil) [sessions addObject:json];
  }
  resolve(sessions);
}

- (void)removeSession:(NSString *)clientSessionId
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  NSURL *file = [self fileForSession:clientSessionId error:&error];
  if (file != nil) {
    [[NSFileManager defaultManager] removeItemAtURL:file error:NULL];
  }
  resolve(nil);
}

- (void)removeAllSessions:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  NSURL *directory = [self storeDirectory:&error];
  if (directory == nil) {
    resolve(nil);
    return;
  }

  NSArray<NSURL *> *files =
      [[NSFileManager defaultManager] contentsOfDirectoryAtURL:directory
                                   includingPropertiesForKeys:nil
                                                      options:0
                                                        error:NULL];
  for (NSURL *file in files) {
    if ([file.pathExtension isEqualToString:kSessionFileExtension]) {
      [[NSFileManager defaultManager] removeItemAtURL:file error:NULL];
    }
  }
  resolve(nil);
}

@end
