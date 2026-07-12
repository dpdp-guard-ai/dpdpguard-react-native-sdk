import errorCatalog from "@dpdpguard/contract/conformance/error-catalog.json";

/**
 * ADR-002 D2's typed error-code enum, loaded from the installed
 * @dpdpguard/contract package via a static JSON import (Metro and
 * TypeScript's resolveJsonModule both support this directly — unlike the
 * Node server SDK, there's no CommonJS `require()` trick needed here).
 */
export interface ErrorCatalogEntry {
	code: string;
	description: string;
}

export const ERROR_CATALOG: ErrorCatalogEntry[] = errorCatalog.codes;

export type ApiErrorCode =
	| "MINOR_TRACKING_BLOCKED"
	| "NOTICE_NOT_PUBLISHED"
	| "ALREADY_CONSENTED"
	| "NOT_ASSOCIATED_WITH_ORG"
	| "INVALID_STATUS_TRANSITION"
	| "SDK_VERSION_UNSUPPORTED"
	| "NOT_FOUND"
	| "UNAUTHORIZED"
	| "RATE_LIMITED"
	| "VALIDATION_ERROR";

/** Thrown by {@link DpdpGuardClient} for any non-2xx `/api/v1` response. */
export class DpdpGuardApiError extends Error {
	readonly code: ApiErrorCode | string;
	readonly status: number;

	constructor(code: ApiErrorCode | string, message: string, status: number) {
		super(message);
		this.name = "DpdpGuardApiError";
		this.code = code;
		this.status = status;
	}
}
