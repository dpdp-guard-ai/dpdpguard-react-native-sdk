import vectors from "@dpdpguard/contract/conformance/capture-artifact-vectors.json";

import {
	canonicalCaptureString,
	compareUtf8,
	utf8ByteLength,
} from "./captureArtifact";
import type { CaptureArtifactInput } from "./captureArtifact";

interface Vector {
	name: string;
	input: CaptureArtifactInput;
	expectedCanonical: string;
}

describe("canonicalCaptureString", () => {
	const goldenVectors = vectors.vectors as unknown as Vector[];

	test("the contract still ships capture-artifact vectors to check against", () => {
		expect(goldenVectors.length).toBe(7);
	});

	test.each(goldenVectors.map((v) => [v.name, v] as const))(
		"golden vector: %s",
		(_name, vector) => {
			expect(canonicalCaptureString(vector.input)).toBe(vector.expectedCanonical);
		},
	);

	test("the separator-injection pair produces different bytes", () => {
		const a = goldenVectors.find((v) => v.name.startsWith("separator injection A"));
		const b = goldenVectors.find((v) => v.name.startsWith("separator injection B"));
		expect(a && b).toBeTruthy();
		expect(canonicalCaptureString((a as Vector).input)).not.toBe(
			canonicalCaptureString((b as Vector).input),
		);
	});

	test("input arrays are not mutated by the sorts", () => {
		const purposeGrants = [
			{ purposeKey: "marketing", status: "opt_out" as const },
			{ purposeKey: "kyc_verification", status: "opt_in" as const },
		];
		const dataTypes = ["pan", "aadhaar"];

		canonicalCaptureString({
			clientSessionId: "11111111-2222-3333-4444-555555555555",
			organizationId: "org_abc123",
			deviceId: "device_pune_114",
			noticeId: "notice_v3",
			noticeVersion: 3,
			noticeLocale: "hi",
			purposeGrants,
			dataTypes,
			principalHandleKind: "phone_hash",
			principalHandleValue: "9876543210",
			capturedAtClient: 1700000000000,
			channel: "agent_app",
		});

		expect(purposeGrants.map((g) => g.purposeKey)).toEqual([
			"marketing",
			"kyc_verification",
		]);
		expect(dataTypes).toEqual(["pan", "aadhaar"]);
	});

	test("rejects duplicate purposeKeys rather than letting sync quarantine them", () => {
		expect(() =>
			canonicalCaptureString({
				clientSessionId: "11111111-2222-3333-4444-555555555555",
				organizationId: "org_abc123",
				deviceId: "device_pune_114",
				noticeId: "notice_v3",
				noticeVersion: 3,
				noticeLocale: "en",
				purposeGrants: [
					{ purposeKey: "kyc", status: "opt_in" },
					{ purposeKey: "kyc", status: "opt_out" },
				],
				dataTypes: ["pan"],
				principalHandleKind: "none",
				principalHandleValue: "",
				capturedAtClient: 1700000000000,
				channel: "agent_app",
			}),
		).toThrow(/duplicate purposeKey "kyc"/);
	});
});

describe("UTF-8 primitives", () => {
	test("byte length counts UTF-8 bytes, not characters or UTF-16 units", () => {
		expect(utf8ByteLength("pan")).toBe(3);
		// Five Devanagari characters, three bytes each.
		expect("विपणन".length).toBe(5);
		expect(utf8ByteLength("विपणन")).toBe(15);
		// Astral plane: one code point, two UTF-16 units, four UTF-8 bytes.
		expect("\u{1F600}".length).toBe(2);
		expect(utf8ByteLength("\u{1F600}")).toBe(4);
	});

	test("sorts byte-wise, where the UTF-16 default would disagree", () => {
		// U+1F600 (surrogate pair, UTF-8 f0 9f 98 80) vs U+FB00 (UTF-8 ef ac 80).
		// Byte-wise, U+FB00 sorts first; JS's default sort puts the surrogate
		// pair first because 0xD83D < 0xFB00 as UTF-16 code units.
		const astral = "\u{1F600}";
		const bmp = "ﬀ";
		expect(compareUtf8(bmp, astral)).toBeLessThan(0);
		expect([astral, bmp].sort()).toEqual([astral, bmp]);
		expect([astral, bmp].sort(compareUtf8)).toEqual([bmp, astral]);
	});
});
