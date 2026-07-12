import { ERROR_CATALOG } from "./errorCatalog";

describe("ERROR_CATALOG", () => {
	test("loads all 10 codes from the installed @dpdpguard/contract package", () => {
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
		]);
	});
});
