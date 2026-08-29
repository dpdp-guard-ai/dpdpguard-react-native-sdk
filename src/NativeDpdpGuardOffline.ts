import { TurboModuleRegistry } from "react-native";
import type { TurboModule } from "react-native";

/**
 * The native surface offline capture needs, and nothing more.
 *
 * Scope is deliberately narrow: **the native side does key storage,
 * signing, and encrypted persistence only.** The `dpdpcca/2`
 * canonicalization stays in JavaScript
 * (`src/offline/captureArtifact.ts`), where one implementation is tested
 * against the contract's golden vectors, rather than being written twice
 * in Swift and Kotlin where the two could silently drift — and drift there
 * means a legitimate consent quarantining as `signature_mismatch` on sync.
 *
 * This mirrors `docs/specs/offline-consent-capture.md` §4.1's "do not build
 * a third consent engine": the engine is the canonical string plus the
 * server's verification, and neither is duplicated here.
 */
export interface Spec extends TurboModule {
	/**
	 * Creates the device's ECDSA P-256 signing key if it does not exist and
	 * returns its base64 SPKI DER public key — the value enrolled on the
	 * `agentDevices` row. The private key is generated inside the platform's
	 * secure element and never leaves the device.
	 */
	enrollDevice(): Promise<string>;

	/** The enrolled public key, or `null` if this device has never enrolled. */
	getPublicKey(): Promise<string | null>;

	/**
	 * `true` when the private key lives in hardware (Secure Enclave /
	 * StrongBox or TEE), `false` when the platform forced a software
	 * fallback (Simulator, emulator, older devices). Surfaced so a host app
	 * can decide whether to allow offline capture on the device at all;
	 * the server cannot tell the difference from the signature alone.
	 */
	isHardwareBacked(): Promise<boolean>;

	/**
	 * Signs the UTF-8 bytes of `canonical` with ECDSA P-256 / SHA-256 and
	 * returns the raw IEEE-P1363 `r||s` pair, base64-encoded — the exact
	 * shape `POST /api/v1/offline/captures` verifies.
	 */
	sign(canonical: string): Promise<string>;

	/**
	 * Persists one pending session, encrypted at rest, keyed by
	 * `clientSessionId`. Overwrites an existing entry with the same id, so
	 * a retried capture is idempotent locally as well as at sync.
	 */
	saveSession(clientSessionId: string, sessionJson: string): Promise<void>;

	/** Every pending session's JSON, decrypted. Corrupt entries are skipped. */
	loadPendingSessions(): Promise<string[]>;

	/** Evicts one session — called only once the server has acknowledged it. */
	removeSession(clientSessionId: string): Promise<void>;

	/** Evicts every pending session. */
	removeAllSessions(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("DpdpGuardOffline");
