import { canonicalCaptureString } from "./captureArtifact";
import type { Spec as OfflineNativeSpec } from "../NativeDpdpGuardOffline";
import type {
	CaptureInput,
	OfflineCaptureResult,
	OfflineCaptureSession,
	OfflineCaptureSyncBody,
	OfflineCaptureTransport,
} from "./types";

/** `POST /api/v1/offline/captures` rejects a batch larger than this. */
export const MAX_SYNC_BATCH = 200;

export interface OfflineCaptureManagerOptions {
	organizationId: string;
	/** The enrolled `agentDevices` row id for this device. */
	deviceId: string;
	/**
	 * The native binding. Defaults to the `DpdpGuardOffline` TurboModule;
	 * inject a fake in tests, or to run the capture flow on a platform
	 * where the native module isn't installed.
	 */
	native?: OfflineNativeSpec;
}

/**
 * Device-side offline consent capture — the client half of
 * `docs/specs/offline-consent-capture.md` §4.
 *
 * {@link OfflineCaptureManager.capture} does no network I/O at all: it
 * builds the `dpdpcca/2` canonical string, has the secure element sign it,
 * and persists the session to the encrypted local store.
 * {@link OfflineCaptureManager.syncPending} drains that store when
 * connectivity returns and evicts every session the server acknowledges.
 */
export class OfflineCaptureManager {
	private readonly organizationId: string;
	private readonly deviceId: string;
	private readonly native: OfflineNativeSpec;
	private sequence = 0;

	constructor(options: OfflineCaptureManagerOptions) {
		this.organizationId = options.organizationId;
		this.deviceId = options.deviceId;
		// The native module is required lazily so that importing this package
		// on a platform without it (a plain Node test runner, web) doesn't
		// throw at import time — only constructing a manager without an
		// injected `native` does.
		this.native =
			options.native ??
			(require("../NativeDpdpGuardOffline").default as OfflineNativeSpec);
	}

	/**
	 * Creates the device's secure-element signing key if needed and returns
	 * its base64 SPKI DER public key, plus whether the key is actually
	 * hardware-backed. Enroll that public key on `agentDevices` through the
	 * fleet-enrollment console flow before any capture will verify.
	 */
	async enroll(): Promise<{
		publicKeySPKIBase64: string;
		hardwareBacked: boolean;
	}> {
		const publicKeySPKIBase64 = await this.native.enrollDevice();
		const hardwareBacked = await this.native.isHardwareBacked();
		return { publicKeySPKIBase64, hardwareBacked };
	}

	/**
	 * Signs and queues one capture. Works at zero bars — nothing here
	 * touches the network.
	 */
	async capture(input: CaptureInput): Promise<OfflineCaptureSession> {
		const clientSessionId = input.clientSessionId ?? generateUuidV4();
		const capturedAtClient = input.capturedAtClient ?? Date.now();

		const canonical = canonicalCaptureString({
			clientSessionId,
			organizationId: this.organizationId,
			deviceId: this.deviceId,
			noticeId: input.noticeId,
			noticeVersion: input.noticeVersion,
			noticeLocale: input.noticeLocale,
			purposeGrants: input.purposeGrants.map((grant) => ({
				purposeKey: grant.purposeKey,
				status: grant.status,
			})),
			dataTypes: input.dataTypes,
			principalHandleKind: input.principalHandle?.kind ?? "none",
			principalHandleValue: input.principalHandle?.value ?? "",
			capturedAtClient,
			channel: input.channel,
		});

		const deviceSignature = await this.native.sign(canonical);

		this.sequence += 1;
		const session: OfflineCaptureSession = {
			clientSessionId,
			organizationId: this.organizationId,
			deviceId: this.deviceId,
			noticeId: input.noticeId,
			noticeVersion: input.noticeVersion,
			noticeLocale: input.noticeLocale,
			channel: input.channel,
			capturedAtClient,
			captureSequence: this.sequence,
			purposeGrants: input.purposeGrants,
			dataTypes: input.dataTypes,
			canonical,
			deviceSignature,
			...(input.principalHandle
				? { principalHandle: input.principalHandle }
				: {}),
			...(input.linkId ? { linkId: input.linkId } : {}),
		};

		await this.native.saveSession(clientSessionId, JSON.stringify(session));
		return session;
	}

	/** Every queued session, oldest capture first. */
	async pendingSessions(): Promise<OfflineCaptureSession[]> {
		const raw = await this.native.loadPendingSessions();
		const sessions: OfflineCaptureSession[] = [];
		for (const entry of raw) {
			try {
				sessions.push(JSON.parse(entry) as OfflineCaptureSession);
			} catch {
				// A corrupt entry is skipped rather than failing the whole
				// drain — the native store reports these separately.
			}
		}
		return sessions.sort((a, b) => a.capturedAtClient - b.capturedAtClient);
	}

	/**
	 * Drains the local store through `transport`, in batches of at most
	 * {@link MAX_SYNC_BATCH}, and evicts every session the server
	 * acknowledged.
	 *
	 * All three statuses are terminal acknowledgements: a `quarantined` or
	 * `rejected` session is retained *server-side* as evidence (spec §4.4 —
	 * never silently dropped), so keeping a local copy would only mean
	 * re-submitting it forever.
	 *
	 * Partial batch success is normal and is not an error: inspect the
	 * returned results rather than assuming a resolved promise means every
	 * capture committed.
	 */
	async syncPending(
		transport: OfflineCaptureTransport,
	): Promise<OfflineCaptureResult[]> {
		const pending = await this.pendingSessions();
		const results: OfflineCaptureResult[] = [];

		for (let i = 0; i < pending.length; i += MAX_SYNC_BATCH) {
			const batch = pending.slice(i, i + MAX_SYNC_BATCH);
			const response = await transport(toSyncBody(batch));
			const batchResults = response.results ?? [];
			results.push(...batchResults);

			for (const result of batchResults) {
				await this.native.removeSession(result.clientSessionId);
			}
		}

		return results;
	}

	/** Drops every queued session without syncing. */
	clearPending(): Promise<void> {
		return this.native.removeAllSessions();
	}
}

/**
 * Maps queued sessions to the `POST /api/v1/offline/captures` body.
 * `organizationId`, `canonical`, and `captureSequence` are local-only — the
 * server derives the org from the API key and recomputes the canonical
 * string itself.
 */
export function toSyncBody(
	sessions: OfflineCaptureSession[],
): OfflineCaptureSyncBody {
	return {
		sessions: sessions.map((session) => ({
			clientSessionId: session.clientSessionId,
			deviceId: session.deviceId,
			noticeId: session.noticeId,
			noticeVersion: session.noticeVersion,
			noticeLocale: session.noticeLocale,
			channel: session.channel,
			capturedAtClient: session.capturedAtClient,
			deviceSignature: session.deviceSignature,
			dataTypes: session.dataTypes,
			purposeGrants: session.purposeGrants,
			...(session.principalHandle
				? { principalHandle: session.principalHandle }
				: {}),
			...(session.linkId ? { linkId: session.linkId } : {}),
		})),
	};
}

/**
 * UUIDv4 for `clientSessionId`. This is an idempotency key, not a secret,
 * but it still prefers a CSPRNG where one exists; the `Math.random`
 * fallback only runs on a JS engine exposing neither `crypto.randomUUID`
 * nor `crypto.getRandomValues`.
 */
function generateUuidV4(): string {
	const cryptoObj = (
		globalThis as {
			crypto?: {
				randomUUID?: () => string;
				getRandomValues?: (array: Uint8Array) => Uint8Array;
			};
		}
	).crypto;

	if (typeof cryptoObj?.randomUUID === "function") {
		return cryptoObj.randomUUID();
	}

	const bytes = new Uint8Array(16);
	if (typeof cryptoObj?.getRandomValues === "function") {
		cryptoObj.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i += 1) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}

	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex: string[] = [];
	for (let i = 0; i < 16; i += 1) {
		hex.push(bytes[i].toString(16).padStart(2, "0"));
	}
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10, 16).join(""),
	].join("-");
}
