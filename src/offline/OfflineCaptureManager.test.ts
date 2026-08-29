import { canonicalCaptureString } from "./captureArtifact";
import {
	MAX_SYNC_BATCH,
	OfflineCaptureManager,
	toSyncBody,
} from "./OfflineCaptureManager";
import type { Spec as OfflineNativeSpec } from "../NativeDpdpGuardOffline";
import type { CaptureInput, OfflineCaptureResult } from "./types";

/**
 * An in-memory stand-in for the native module: the same contract, without
 * a secure element. `sign` records what it was asked to sign so the tests
 * can assert the JS layer hands the native side the exact canonical bytes.
 */
function fakeNative(): OfflineNativeSpec & { signed: string[] } {
	const store = new Map<string, string>();
	const signed: string[] = [];

	return {
		signed,
		enrollDevice: async () => "BASE64_SPKI_PUBLIC_KEY",
		getPublicKey: async () => "BASE64_SPKI_PUBLIC_KEY",
		isHardwareBacked: async () => true,
		sign: async (canonical: string) => {
			signed.push(canonical);
			return `sig(${signed.length})`;
		},
		saveSession: async (clientSessionId: string, sessionJson: string) => {
			store.set(clientSessionId, sessionJson);
		},
		loadPendingSessions: async () => Array.from(store.values()),
		removeSession: async (clientSessionId: string) => {
			store.delete(clientSessionId);
		},
		removeAllSessions: async () => {
			store.clear();
		},
	} as OfflineNativeSpec & { signed: string[] };
}

const captureInput: CaptureInput = {
	noticeId: "notice_v3",
	noticeVersion: 3,
	noticeLocale: "hi",
	purposeGrants: [
		{
			purposeKey: "kyc_verification",
			purposeLabel: "KYC verification",
			category: "essential",
			status: "opt_in",
		},
		{
			purposeKey: "marketing",
			purposeLabel: "Marketing",
			category: "non_essential",
			status: "opt_out",
		},
	],
	dataTypes: ["pan", "aadhaar"],
	principalHandle: { kind: "phone_hash", value: "9876543210" },
	channel: "agent_app",
	clientSessionId: "11111111-2222-3333-4444-555555555555",
	capturedAtClient: 1700000000000,
};

function makeManager(native = fakeNative()) {
	return {
		native,
		manager: new OfflineCaptureManager({
			organizationId: "org_abc123",
			deviceId: "device_pune_114",
			native,
		}),
	};
}

describe("OfflineCaptureManager.capture", () => {
	test("signs exactly the dpdpcca/2 canonical string and does no network I/O", async () => {
		const { manager, native } = makeManager();

		const session = await manager.capture(captureInput);

		const expected = canonicalCaptureString({
			clientSessionId: "11111111-2222-3333-4444-555555555555",
			organizationId: "org_abc123",
			deviceId: "device_pune_114",
			noticeId: "notice_v3",
			noticeVersion: 3,
			noticeLocale: "hi",
			purposeGrants: [
				{ purposeKey: "kyc_verification", status: "opt_in" },
				{ purposeKey: "marketing", status: "opt_out" },
			],
			dataTypes: ["pan", "aadhaar"],
			principalHandleKind: "phone_hash",
			principalHandleValue: "9876543210",
			capturedAtClient: 1700000000000,
			channel: "agent_app",
		});

		expect(native.signed).toEqual([expected]);
		expect(session.canonical).toBe(expected);
		expect(session.deviceSignature).toBe("sig(1)");
	});

	test("persists the capture so it survives until sync", async () => {
		const { manager } = makeManager();

		await manager.capture(captureInput);
		const pending = await manager.pendingSessions();

		expect(pending).toHaveLength(1);
		expect(pending[0].clientSessionId).toBe(
			"11111111-2222-3333-4444-555555555555",
		);
		expect(pending[0].organizationId).toBe("org_abc123");
	});

	test("generates a UUIDv4 clientSessionId when the caller omits one", async () => {
		const { manager } = makeManager();

		const session = await manager.capture({
			...captureInput,
			clientSessionId: undefined,
		});

		expect(session.clientSessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	test("only purposeKey and status reach the signature, not label or category", async () => {
		const { manager, native } = makeManager();

		await manager.capture(captureInput);

		expect(native.signed[0]).not.toContain("KYC verification");
		expect(native.signed[0]).not.toContain("essential");
		expect(native.signed[0]).toContain("kyc_verification");
	});

	test("records a monotonic sequence so capture ordering survives a wrong clock", async () => {
		const { manager } = makeManager();

		const first = await manager.capture({
			...captureInput,
			clientSessionId: "a1111111-2222-3333-4444-555555555555",
		});
		const second = await manager.capture({
			...captureInput,
			clientSessionId: "b1111111-2222-3333-4444-555555555555",
			// A backwards clock must not reorder the captures.
			capturedAtClient: 1600000000000,
		});

		expect(first.captureSequence).toBe(1);
		expect(second.captureSequence).toBe(2);
	});
});

describe("OfflineCaptureManager.syncPending", () => {
	function results(ids: string[]): OfflineCaptureResult[] {
		return ids.map((clientSessionId) => ({
			clientSessionId,
			status: "verified" as const,
		}));
	}

	test("evicts every acknowledged session, including quarantined ones", async () => {
		const { manager } = makeManager();
		await manager.capture({
			...captureInput,
			clientSessionId: "a1111111-2222-3333-4444-555555555555",
		});
		await manager.capture({
			...captureInput,
			clientSessionId: "b1111111-2222-3333-4444-555555555555",
		});

		const transport = jest.fn().mockResolvedValue({
			results: [
				{
					clientSessionId: "a1111111-2222-3333-4444-555555555555",
					status: "verified",
					consentId: "consent_1",
				},
				{
					clientSessionId: "b1111111-2222-3333-4444-555555555555",
					status: "quarantined",
					reason: "clock_skew",
				},
			],
		});

		const out = await manager.syncPending(transport);

		expect(out).toHaveLength(2);
		// A quarantined session is retained server-side as evidence; keeping a
		// local copy would only mean resubmitting it forever.
		expect(await manager.pendingSessions()).toEqual([]);
	});

	test("keeps a session the server did not acknowledge", async () => {
		const { manager } = makeManager();
		await manager.capture({
			...captureInput,
			clientSessionId: "a1111111-2222-3333-4444-555555555555",
		});
		await manager.capture({
			...captureInput,
			clientSessionId: "b1111111-2222-3333-4444-555555555555",
		});

		const transport = jest.fn().mockResolvedValue({
			results: results(["a1111111-2222-3333-4444-555555555555"]),
		});

		await manager.syncPending(transport);

		const remaining = await manager.pendingSessions();
		expect(remaining.map((s) => s.clientSessionId)).toEqual([
			"b1111111-2222-3333-4444-555555555555",
		]);
	});

	test("splits a drain into batches the endpoint will accept", async () => {
		const { manager } = makeManager();
		const ids: string[] = [];
		for (let i = 0; i < MAX_SYNC_BATCH + 5; i += 1) {
			const clientSessionId = `${String(i).padStart(8, "0")}-2222-3333-4444-555555555555`;
			ids.push(clientSessionId);
			await manager.capture({
				...captureInput,
				clientSessionId,
				capturedAtClient: 1700000000000 + i,
			});
		}

		const transport = jest
			.fn()
			.mockImplementation(async (body: { sessions: { clientSessionId: string }[] }) => ({
				results: results(body.sessions.map((s) => s.clientSessionId)),
			}));

		await manager.syncPending(transport);

		expect(transport).toHaveBeenCalledTimes(2);
		expect(transport.mock.calls[0][0].sessions).toHaveLength(MAX_SYNC_BATCH);
		expect(transport.mock.calls[1][0].sessions).toHaveLength(5);
		expect(await manager.pendingSessions()).toEqual([]);
	});

	test("does not call the transport when nothing is queued", async () => {
		const { manager } = makeManager();
		const transport = jest.fn();

		expect(await manager.syncPending(transport)).toEqual([]);
		expect(transport).not.toHaveBeenCalled();
	});
});

describe("toSyncBody", () => {
	test("sends the wire fields only — org, canonical and sequence stay local", async () => {
		const { manager } = makeManager();
		const session = await manager.capture(captureInput);

		const [wire] = toSyncBody([session]).sessions;

		expect(Object.keys(wire).sort()).toEqual(
			[
				"capturedAtClient",
				"channel",
				"clientSessionId",
				"dataTypes",
				"deviceId",
				"deviceSignature",
				"noticeId",
				"noticeLocale",
				"noticeVersion",
				"principalHandle",
				"purposeGrants",
			].sort(),
		);
		// The server derives the org from the API key and recomputes the
		// canonical string itself.
		expect(wire).not.toHaveProperty("organizationId");
		expect(wire).not.toHaveProperty("canonical");
		expect(wire).not.toHaveProperty("captureSequence");
	});

	test("omits principalHandle and linkId when they were never captured", async () => {
		const { manager } = makeManager();
		const session = await manager.capture({
			...captureInput,
			principalHandle: undefined,
		});

		const [wire] = toSyncBody([session]).sessions;

		expect(wire).not.toHaveProperty("principalHandle");
		expect(wire).not.toHaveProperty("linkId");
	});
});
