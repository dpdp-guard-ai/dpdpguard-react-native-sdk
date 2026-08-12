import { ERROR_CATALOG } from "./errorCatalog";

describe("ERROR_CATALOG", () => {
	test("loads all 21 codes from the installed @dpdpguard/contract package", () => {
		const codes = ERROR_CATALOG.map((entry) => entry.code);
		expect(codes).toEqual([
			"MINOR_TRACKING_BLOCKED",
			"NOTICE_NOT_PUBLISHED",
			"ALREADY_CONSENTED",
			"NOT_ASSOCIATED_WITH_ORG",
			"INVALID_STATUS_TRANSITION",
			"SDK_VERSION_UNSUPPORTED",
			"NOT_FOUND",
			"UNAUTHORIZED",
			"RATE_LIMITED",
			"VALIDATION_ERROR",
			// Added in @dpdpguard/contract 1.2.0: eleven error codes for the
			// /mcp/v1 agent surface (ADR-007). Additive per ADR-002 D4; this
			// SDK doesn't call /mcp/v1, so the codes are unused here but the
			// catalog is loaded verbatim from the installed contract package.
			"SCOPE_INSUFFICIENT",
			"TOOL_NOT_AVAILABLE",
			"ORG_DISABLED",
			"APPROVAL_REQUIRED",
			"APPROVAL_BACKLOG_FULL",
			"PROPOSAL_EXPIRED",
			"SECOND_REVIEWER_REQUIRED",
			"PROPOSAL_ALREADY_REVIEWED",
			"DATA_VOLUME_EXCEEDED",
			"PLAN_LIMIT_REACHED",
			"AGENT_WRITE_BLOCKED",
		]);
	});
});
