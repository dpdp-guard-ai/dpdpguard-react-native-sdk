import { readFileSync } from "node:fs";
import { join } from "node:path";

import contractPackage from "@dpdpguard/contract/package.json";

/**
 * Drift guard, mirroring dpdpguard-android-sdk's `CONTRACT_VERSION` marker.
 *
 * `src/generated/api-types.ts` is regenerated from whatever
 * `@dpdpguard/contract` the caret range happens to resolve to, so a new
 * contract minor can silently change this SDK's shipped types with nothing
 * in the repo recording it. Pinning the expected version here forces the
 * bump to be a deliberate, reviewed edit (and a CHANGELOG entry) rather
 * than a side effect of `npm install`.
 */
describe("@dpdpguard/contract version", () => {
	const expected = readFileSync(
		join(__dirname, "CONTRACT_VERSION"),
		"utf8",
	).trim();

	test("installed contract matches the recorded CONTRACT_VERSION", () => {
		expect(contractPackage.version).toBe(expected);
	});

	test("generated types cover every path DpdpGuardClient calls", () => {
		const generated = readFileSync(
			join(__dirname, "generated", "api-types.ts"),
			"utf8",
		);
		for (const path of [
			"/api/v1/org/{slug}",
			"/api/v1/org/{orgId}/notices",
			"/api/v1/notices/{noticeId}",
			"/api/v1/org/{orgId}/banner-config",
			"/api/v1/link-anonymous-consent",
			"/api/v1/consents/anonymous",
			"/api/v1/dsr",
			"/api/v1/grievances",
			"/api/v1/nomination",
		]) {
			expect(generated).toContain(`"${path}":`);
		}
	});
});
