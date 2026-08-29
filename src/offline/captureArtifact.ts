/**
 * The Cryptographic Consent Artifact canonicalization — `dpdpcca/2`, from
 * `@dpdpguard/contract`'s `conformance/audit-hash-spec.md` and
 * `docs/specs/offline-consent-capture.md` §4.2 — pinned byte-for-byte by
 * `conformance/capture-artifact-vectors.json`.
 *
 * This is the one part of offline capture that must be identical across
 * every SDK and the server: a device signs these exact bytes, and the
 * server re-derives them at sync. A single byte of drift quarantines a
 * legitimate consent as `signature_mismatch`. It therefore lives here, in
 * JavaScript, tested against the golden vectors — the native modules under
 * `android/` and `ios/` do key storage, signing, and encrypted persistence
 * only, and never reimplement this string.
 */

/** Wire values for `offlineCaptureSessions.channel`. */
export type CaptureChannel = "qr" | "agent_app" | "pos" | "async_link" | "ivr";

/** Per-purpose decision recorded in a capture. */
export type PurposeGrantStatus = "opt_in" | "opt_out";

/** How the Data Principal was identified at capture time. */
export type PrincipalHandleKind = "phone_hash" | "uhid" | "cbs_ref" | "none";

export interface PurposeGrant {
	purposeKey: string;
	status: PurposeGrantStatus;
}

/** The exact fields covered by the device signature. */
export interface CaptureArtifactInput {
	/** Client-generated UUIDv4; also the sync idempotency key. */
	clientSessionId: string;
	organizationId: string;
	/** The `agentDevices` row whose public key must verify this signature. */
	deviceId: string;
	noticeId: string;
	noticeVersion: number;
	/** The Eighth Schedule locale actually rendered — s. 5(3) evidence. */
	noticeLocale: string;
	purposeGrants: PurposeGrant[];
	dataTypes: string[];
	principalHandleKind: PrincipalHandleKind;
	/**
	 * The **raw** handle as collected — signed raw so an SDK need not
	 * reimplement the platform's HMAC. Empty serializes as the literal
	 * `"null"`.
	 */
	principalHandleValue: string;
	/** Device clock. Context, never authority (spec §4.3). */
	capturedAtClient: number;
	channel: CaptureChannel;
}

/** The literal first token of every canonical string. */
export const CAPTURE_ARTIFACT_VERSION = "dpdpcca/2";

/**
 * UTF-8 bytes of `value`. Hand-rolled rather than using `TextEncoder` so
 * this behaves identically on every JS engine React Native ships with,
 * including older Hermes builds where `TextEncoder` is absent.
 */
export function utf8Bytes(value: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < value.length; i += 1) {
		let codePoint = value.charCodeAt(i);

		// Combine a surrogate pair into its single code point.
		if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
			const low = value.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
				i += 1;
			}
		}

		if (codePoint < 0x80) {
			out.push(codePoint);
		} else if (codePoint < 0x800) {
			out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
		} else if (codePoint < 0x10000) {
			out.push(
				0xe0 | (codePoint >> 12),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			);
		} else {
			out.push(
				0xf0 | (codePoint >> 18),
				0x80 | ((codePoint >> 12) & 0x3f),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			);
		}
	}
	return out;
}

/** Token length is counted in UTF-8 bytes — not characters, not UTF-16 units. */
export function utf8ByteLength(value: string): number {
	return utf8Bytes(value).length;
}

/**
 * Byte-wise UTF-8 ordering.
 *
 * Not `String.prototype.sort`'s default: that compares UTF-16 code units,
 * which disagrees with UTF-8 byte order for anything above the BMP (a
 * surrogate pair sorts below U+E000–U+FFFF, its UTF-8 bytes sort above).
 * The sorts are load-bearing — a client that listed its purposes in a
 * different order on retry would otherwise produce a different canonical
 * string and quarantine a legitimate consent.
 */
export function compareUtf8(a: string, b: string): number {
	const left = utf8Bytes(a);
	const right = utf8Bytes(b);
	const shared = Math.min(left.length, right.length);
	for (let i = 0; i < shared; i += 1) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return left.length - right.length;
}

function frame(value: string): string {
	return `${utf8ByteLength(value)}:${value}`;
}

/**
 * Builds the canonical string whose UTF-8 bytes the device signs with
 * ECDSA P-256 / SHA-256.
 *
 * Every token is framed as `<utf8ByteLength>:<value>` and joined with `|`;
 * lists carry an explicit framed count before their framed elements.
 * `purposeGrants` sorts by `purposeKey` and `dataTypes` sorts by value,
 * both byte-wise. Neither input array is mutated.
 *
 * @throws if two grants share a `purposeKey` — duplicates are rejected at
 * sync and never collapsed, so failing here turns a guaranteed
 * server-side rejection into an immediate, debuggable client error.
 */
export function canonicalCaptureString(input: CaptureArtifactInput): string {
	const grants = [...input.purposeGrants].sort((a, b) =>
		compareUtf8(a.purposeKey, b.purposeKey),
	);

	for (let i = 1; i < grants.length; i += 1) {
		if (grants[i].purposeKey === grants[i - 1].purposeKey) {
			throw new Error(
				`canonicalCaptureString: duplicate purposeKey "${grants[i].purposeKey}" — duplicates are rejected at sync, never collapsed.`,
			);
		}
	}

	const dataTypes = [...input.dataTypes].sort(compareUtf8);

	const tokens: string[] = [
		frame(CAPTURE_ARTIFACT_VERSION),
		frame(input.clientSessionId),
		frame(input.organizationId),
		frame(input.deviceId),
		frame(input.noticeId),
		frame(String(input.noticeVersion)),
		frame(input.noticeLocale),
		frame(String(grants.length)),
	];

	for (const grant of grants) {
		tokens.push(frame(grant.purposeKey), frame(grant.status));
	}

	tokens.push(frame(String(dataTypes.length)));
	for (const dataType of dataTypes) {
		tokens.push(frame(dataType));
	}

	tokens.push(
		frame(input.principalHandleKind),
		frame(input.principalHandleValue.length > 0 ? input.principalHandleValue : "null"),
		frame(String(input.capturedAtClient)),
		frame(input.channel),
	);

	return tokens.join("|");
}
