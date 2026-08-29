#import <DpdpGuardOfflineSpec/DpdpGuardOfflineSpec.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Secure-element key storage, ECDSA P-256 signing, and an encrypted local
 * queue for offline consent capture
 * (docs/specs/offline-consent-capture.md §4).
 *
 * Deliberately narrow: this module never builds the `dpdpcca/2` canonical
 * string. That lives in JavaScript (src/offline/captureArtifact.ts), tested
 * against the contract's golden vectors, so there is exactly one
 * implementation of the bytes a signature commits to.
 */
@interface DpdpGuardOffline : NSObject <NativeDpdpGuardOfflineSpec>
@end

NS_ASSUME_NONNULL_END
