import { hasConsent } from "./consentGate";

describe("hasConsent", () => {
	test("true when a matching purpose has no withdrawnAt", () => {
		expect(hasConsent([{ purpose: "Analytics" }], "Analytics")).toBe(true);
	});

	test("false when the matching purpose was withdrawn", () => {
		expect(
			hasConsent([{ purpose: "Analytics", withdrawnAt: 123 }], "Analytics"),
		).toBe(false);
	});

	test("false when no record matches the purpose", () => {
		expect(hasConsent([{ purpose: "Marketing" }], "Analytics")).toBe(false);
	});
});
