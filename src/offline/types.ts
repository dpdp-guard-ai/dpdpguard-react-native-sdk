import type {
	CaptureChannel,
	PrincipalHandleKind,
	PurposeGrantStatus,
} from "./captureArtifact";

/** Whether a purpose is one the service cannot run without. */
export type PurposeCategory = "essential" | "non_essential";

/**
 * A per-purpose decision as it goes over the wire. Note only `purposeKey`
 * and `status` are covered by the device signature — `purposeLabel` and
 * `category` are carried for the server's records and are not part of the
 * `dpdpcca/2` canonical string.
 */
export interface CapturePurposeGrant {
	purposeKey: string;
	purposeLabel: string;
	category: PurposeCategory;
	status: PurposeGrantStatus;
}

/** The identity the principal can later withdraw by. */
export interface PrincipalHandle {
	kind: PrincipalHandleKind;
	/**
	 * The raw handle as collected. Signed raw so an SDK need not
	 * reimplement the platform's HMAC; a `phone_hash` value is HMAC'd
	 * per-organization server-side and the raw number is never persisted.
	 */
	value: string;
}

/** What a host app passes to {@link OfflineCaptureManager.capture}. */
export interface CaptureInput {
	noticeId: string;
	noticeVersion: number;
	/** The Eighth Schedule locale actually rendered to the principal. */
	noticeLocale: string;
	/**
	 * Every purpose the principal was *shown*, opted in or out. Declined
	 * purposes are submitted too: proving someone was shown marketing and
	 * refused is what distinguishes granular consent from a notice that
	 * quietly omitted it.
	 */
	purposeGrants: CapturePurposeGrant[];
	dataTypes: string[];
	principalHandle?: PrincipalHandle;
	channel: CaptureChannel;
	/** Set for QR-originated captures only. */
	linkId?: string;
	/** Defaults to a generated UUIDv4. Also the sync idempotency key. */
	clientSessionId?: string;
	/** Defaults to `Date.now()`. Context, never authority (spec §4.3). */
	capturedAtClient?: number;
}

/**
 * A signed, persisted capture awaiting sync.
 *
 * `canonical` is stored alongside the signature deliberately: the
 * signature is only meaningful against the exact bytes that were signed,
 * so keeping them means a session stays re-verifiable even if this SDK
 * later moves to a newer canonicalization version.
 */
export interface OfflineCaptureSession {
	clientSessionId: string;
	organizationId: string;
	deviceId: string;
	noticeId: string;
	noticeVersion: number;
	noticeLocale: string;
	channel: CaptureChannel;
	capturedAtClient: number;
	/** Boot-relative ordering counter — see spec §4.3 on clock trust. */
	captureSequence: number;
	purposeGrants: CapturePurposeGrant[];
	dataTypes: string[];
	principalHandle?: PrincipalHandle;
	linkId?: string;
	/** The exact `dpdpcca/2` string that was signed. */
	canonical: string;
	/** base64 of the raw IEEE-P1363 `r||s` ECDSA P-256 signature. */
	deviceSignature: string;
}

/** One session's outcome from `POST /api/v1/offline/captures`. */
export interface OfflineCaptureResult {
	clientSessionId: string;
	status: "verified" | "quarantined" | "rejected";
	consentId?: string;
	/**
	 * Present for a non-verified session — `unknown_device`,
	 * `device_revoked`, `signature_mismatch`, `clock_skew`,
	 * `notice_unpublished`, `notice_superseded`, or `invalid_session`.
	 */
	reason?: string;
	/**
	 * Present when a consent receipt was issued. Hand this to the principal
	 * — it is what makes the consent withdrawable under s. 6(4).
	 */
	withdrawalToken?: string;
}

/** The request body `POST /api/v1/offline/captures` expects. */
export interface OfflineCaptureSyncBody {
	sessions: {
		clientSessionId: string;
		deviceId: string;
		noticeId: string;
		noticeVersion: number;
		noticeLocale: string;
		channel: CaptureChannel;
		capturedAtClient: number;
		deviceSignature: string;
		dataTypes: string[];
		purposeGrants: CapturePurposeGrant[];
		principalHandle?: PrincipalHandle;
		linkId?: string;
	}[];
}

/**
 * How a batch actually reaches DPDP Guard.
 *
 * `POST /api/v1/offline/captures` is declared `security: [apiKey]` — an
 * org-scoped service key. This SDK never holds one (see README.md's
 * "What's here vs. what's not"), so it cannot call that endpoint itself.
 * The host app supplies this function; in practice it POSTs `body` to its
 * own backend, which adds the API key and forwards it unchanged.
 */
export type OfflineCaptureTransport = (
	body: OfflineCaptureSyncBody,
) => Promise<{ results: OfflineCaptureResult[] }>;
