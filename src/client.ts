import { DpdpGuardApiError } from "./errorCatalog";
import type { components } from "./generated/api-types";

type OrgSummary = components["schemas"]["OrgSummary"];
type Notice = components["schemas"]["Notice"];
type DsrRequest = components["schemas"]["DsrRequest"];
type Grievance = components["schemas"]["Grievance"];
type Nomination = components["schemas"]["Nomination"];

export interface DpdpGuardClientOptions {
	/** e.g. "https://trustworthy-alligator-303.convex.site" */
	baseUrl: string;
	/**
	 * A brokered principal access token (ADR-004 D1/D2), obtained from your
	 * own app backend — this client deliberately has no `brokerToken()`
	 * method or API-key option. Minting a token requires a service API key
	 * (convex/apiKeys.ts), which must never ship inside a mobile app
	 * bundle; brokering stays server-side.
	 */
	accessToken?: string;
	/** Override for testing; defaults to the global `fetch` (RN provides one natively). */
	fetchImpl?: typeof fetch;
}

type AuthMode = "none" | "bearer";

interface RequestOptions {
	body?: unknown;
	auth?: AuthMode;
	headers?: Record<string, string>;
}

/**
 * Thin typed client over DPDP Guard's public `/api/v1` (spec §4.2), for use
 * from a React Native app. Wraps the openapi-typescript-generated
 * request/response shapes (src/generated/api-types.ts) in ergonomic
 * methods, and maps every non-2xx response to a {@link DpdpGuardApiError}
 * keyed by the ADR-002 error catalog's `code`.
 */
export class DpdpGuardClient {
	private readonly baseUrl: string;
	private accessToken: string | undefined;
	private readonly fetchImpl: typeof fetch;

	constructor(options: DpdpGuardClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.accessToken = options.accessToken;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	/** Set/replace the brokered principal access token (e.g. after your backend re-brokers on expiry). */
	setAccessToken(token: string): void {
		this.accessToken = token;
	}

	private async request<T>(
		method: string,
		path: string,
		options: RequestOptions = {},
	): Promise<T> {
		const auth = options.auth ?? "bearer";
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...options.headers,
		};

		if (auth === "bearer") {
			if (!this.accessToken) {
				throw new Error(
					"DpdpGuardClient: this call requires an access token — call setAccessToken() with a token from your own backend first.",
				);
			}
			headers.Authorization = `Bearer ${this.accessToken}`;
		}

		const init: RequestInit = { method, headers };
		if (options.body !== undefined) {
			init.body = JSON.stringify(options.body);
		}
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);

		const text = await response.text();
		const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;

		if (!response.ok) {
			const code =
				json && typeof json === "object" && "code" in json
					? String((json as { code: unknown }).code)
					: "VALIDATION_ERROR";
			const message =
				json && typeof json === "object" && "error" in json
					? String((json as { error: unknown }).error)
					: `Request failed with status ${response.status}`;
			throw new DpdpGuardApiError(code, message, response.status);
		}

		return json as T;
	}

	// --- Public reads (no auth) ---

	getOrganization(slug: string): Promise<OrgSummary> {
		return this.request("GET", `/api/v1/org/${encodeURIComponent(slug)}`, {
			auth: "none",
		});
	}

	getNotices(orgId: string): Promise<{ notices: Notice[] }> {
		return this.request(
			"GET",
			`/api/v1/org/${encodeURIComponent(orgId)}/notices`,
			{ auth: "none" },
		);
	}

	getNotice(noticeId: string): Promise<Notice> {
		return this.request(
			"GET",
			`/api/v1/notices/${encodeURIComponent(noticeId)}`,
			{ auth: "none" },
		);
	}

	getBannerConfig(
		orgId: string,
		scope?: { domain?: string; appId?: string },
	): Promise<{ bannerSettings?: Record<string, never>; configVersion: number }> {
		const query = new URLSearchParams();
		if (scope?.domain) query.set("domain", scope.domain);
		if (scope?.appId) query.set("appId", scope.appId);
		const qs = query.toString();
		return this.request(
			"GET",
			`/api/v1/org/${encodeURIComponent(orgId)}/banner-config${qs ? `?${qs}` : ""}`,
			{ auth: "none" },
		);
	}

	// --- Anonymous → known-user reconciliation (ADR-004 D3) ---

	linkAnonymousConsent(
		anonymousId: string,
	): Promise<{
		linkedCount: number;
		needsReconsent: { noticeId: string; purpose: string }[];
	}> {
		return this.request("POST", "/api/v1/link-anonymous-consent", {
			body: { anonymousId },
		});
	}

	/**
	 * Records consent for a not-yet-authenticated guest (ADR-004 D6), e.g.
	 * from a consent banner shown before login. Unauthenticated, rate-limited
	 * public write, keyed by a client-generated `anonymousId`.
	 */
	giveConsentAnonymous(
		input: {
			organizationId: string;
			noticeId: string;
			purpose: string;
			dataTypes: string[];
			anonymousId: string;
		},
		idempotencyKey?: string,
	): Promise<{
		consentId: string;
		purpose: string;
		dataTypes: string[];
		givenAt: number;
	}> {
		const options: RequestOptions = { body: input, auth: "none" };
		if (idempotencyKey !== undefined) {
			options.headers = { "Idempotency-Key": idempotencyKey };
		}
		return this.request("POST", "/api/v1/consents/anonymous", options);
	}

	// --- DSR (spec §4.2) ---

	listDsrRequests(): Promise<{ requests: DsrRequest[] }> {
		return this.request("GET", "/api/v1/dsr");
	}

	createDsrRequest(
		input: {
			organizationId: string;
			type: "summary" | "processors" | "correction" | "erasure";
			details?: string;
		},
		idempotencyKey?: string,
	): Promise<DsrRequest> {
		const options: RequestOptions = { body: input };
		if (idempotencyKey !== undefined) {
			options.headers = { "Idempotency-Key": idempotencyKey };
		}
		return this.request("POST", "/api/v1/dsr", options);
	}

	// --- Grievances (spec §4.2) ---

	listGrievances(): Promise<{ grievances: Grievance[] }> {
		return this.request("GET", "/api/v1/grievances");
	}

	createGrievance(input: {
		organizationId: string;
		subject: string;
		description: string;
	}): Promise<Grievance> {
		return this.request("POST", "/api/v1/grievances", { body: input });
	}

	// --- Nomination (spec §4.2) ---

	getNomination(): Promise<Nomination | null> {
		return this.request("GET", "/api/v1/nomination");
	}

	upsertNomination(input: {
		nomineeName: string;
		nomineeContact: string;
	}): Promise<Nomination> {
		return this.request("PUT", "/api/v1/nomination", { body: input });
	}

	revokeNomination(): Promise<{ revoked: boolean }> {
		return this.request("DELETE", "/api/v1/nomination");
	}
}
