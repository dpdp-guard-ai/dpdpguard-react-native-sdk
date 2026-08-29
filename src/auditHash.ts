/**
 * ADR-002 D5 audit-hash canonicalization, ported from
 * `@dpdpguard/contract`'s `conformance/audit-hash-spec.md` and pinned by the
 * golden vectors in `conformance/audit-hash-vectors.json`.
 *
 * **This module deliberately stops at the canonical string.** The full
 * `auditHash` is `HMAC-SHA256(canonical, DPDP_AUDIT_HASH_HMAC_SECRET)`, and
 * that secret is server-side-only — the spec's "Key management" section is
 * explicit that it never leaves DPDP Guard's infrastructure, and anything
 * shipped in a React Native bundle is extractable from the app binary. So
 * unlike `dpdpguard-ios-sdk` and `dpdpguard-android-sdk`, which both expose
 * `computeAuditHash(input, secret)` because a server-side caller may
 * legitimately hold the key, this package exposes only the unkeyed half.
 *
 * What that half is good for: producing the exact bytes your own backend
 * will sign, and re-deriving the canonical form of a record so you can
 * check a hash your backend computed refers to the event you think it does.
 */

/** ADR-004 D5 auth provenance for a consent event. */
export type ConsentSource = "brokered" | "direct" | "anonymous" | "linked";

/**
 * The exact fields the canonicalization is computed over. Every field is
 * always present in the canonical string — an absent {@link source}
 * serializes as the literal `"null"`, never an omitted position — so this is
 * a *versioned*, safety-critical algorithm. Changing field order or the
 * `"null"` sentinel is a major bump requiring fresh DPO sign-off.
 */
export interface AuditHashInput {
	organizationId: string;
	noticeId: string;
	noticeVersion: number;
	purpose: string;
	dataTypes: string[];
	/** Unix epoch milliseconds. Client-authoritative per ADR-003 D3. */
	givenAt: number;
	source?: ConsentSource | null;
}

/**
 * The `|`-joined canonical string for `input`, per the spec's "Canonical
 * form":
 *
 * ```
 * organizationId|noticeId|noticeVersion|purpose|dataTypes(sorted,joined by ",")|givenAt|source("null" if absent)
 * ```
 *
 * `dataTypes` is sorted lexicographically, so call order never changes the
 * result. The input array is not mutated.
 */
export function canonicalAuditString(input: AuditHashInput): string {
	const sortedDataTypes = [...input.dataTypes].sort().join(",");
	return [
		input.organizationId,
		input.noticeId,
		String(input.noticeVersion),
		input.purpose,
		sortedDataTypes,
		String(input.givenAt),
		input.source ?? "null",
	].join("|");
}
