import vectors from "@dpdpguard/contract/conformance/audit-hash-vectors.json";

import { canonicalAuditString } from "./auditHash";
import type { AuditHashInput } from "./auditHash";

interface Vector {
	name: string;
	input: AuditHashInput;
	expectedCanonical: string;
	expectedHash: string;
}

describe("canonicalAuditString", () => {
	const goldenVectors = vectors.vectors as unknown as Vector[];

	test("the contract still ships golden vectors to check against", () => {
		expect(goldenVectors.length).toBeGreaterThan(0);
	});

	test.each(goldenVectors.map((v) => [v.name, v] as const))(
		"golden vector: %s",
		(_name, vector) => {
			expect(canonicalAuditString(vector.input)).toBe(
				vector.expectedCanonical,
			);
		},
	);

	test("sorts dataTypes lexicographically without mutating the input", () => {
		const dataTypes = ["phone", "email", "deviceId"];
		const canonical = canonicalAuditString({
			organizationId: "org_abc123",
			noticeId: "notice_v1",
			noticeVersion: 1,
			purpose: "Marketing",
			dataTypes,
			givenAt: 1700000000000,
			source: "direct",
		});

		expect(canonical).toContain("|deviceId,email,phone|");
		expect(dataTypes).toEqual(["phone", "email", "deviceId"]);
	});

	test("an omitted source serializes identically to an explicit null", () => {
		const base = {
			organizationId: "org_abc123",
			noticeId: "notice_v1",
			noticeVersion: 1,
			purpose: "Newsletter",
			dataTypes: ["email"],
			givenAt: 1700000003000,
		};

		expect(canonicalAuditString(base)).toBe(
			canonicalAuditString({ ...base, source: null }),
		);
		expect(canonicalAuditString(base).endsWith("|null")).toBe(true);
	});

	test("empty dataTypes still occupies its position", () => {
		expect(
			canonicalAuditString({
				organizationId: "org_abc123",
				noticeId: "notice_v1",
				noticeVersion: 1,
				purpose: "Newsletter",
				dataTypes: [],
				givenAt: 1700000000000,
				source: "direct",
			}),
		).toBe("org_abc123|notice_v1|1|Newsletter||1700000000000|direct");
	});
});
