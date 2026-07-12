import { DpdpGuardClient } from "./client";
import { DpdpGuardApiError } from "./errorCatalog";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("DpdpGuardClient", () => {
	test("getOrganization calls the public endpoint with no Authorization header", async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(
				jsonResponse(200, { orgId: "org_1", name: "Acme", slug: "acme" }),
			);
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			fetchImpl,
		});

		const org = await client.getOrganization("acme");

		expect(org).toEqual({ orgId: "org_1", name: "Acme", slug: "acme" });
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://example.convex.site/api/v1/org/acme");
		expect(init.headers.Authorization).toBeUndefined();
	});

	test("an authenticated call without setAccessToken() throws before hitting the network", async () => {
		const fetchImpl = jest.fn();
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			fetchImpl,
		});

		await expect(client.listDsrRequests()).rejects.toThrow(/access token/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("setAccessToken() makes subsequent authenticated calls use the new token", async () => {
		const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { requests: [] }));
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			fetchImpl,
		});

		client.setAccessToken("token-from-my-backend");
		await client.listDsrRequests();

		const [, init] = fetchImpl.mock.calls[0];
		expect(init.headers.Authorization).toBe("Bearer token-from-my-backend");
	});

	test("a constructor-supplied accessToken is used immediately", async () => {
		const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { requests: [] }));
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			accessToken: "initial-token",
			fetchImpl,
		});

		await client.listDsrRequests();

		const [, init] = fetchImpl.mock.calls[0];
		expect(init.headers.Authorization).toBe("Bearer initial-token");
	});

	test("a non-2xx response is thrown as a typed DpdpGuardApiError", async () => {
		const fetchImpl = jest
			.fn()
			.mockImplementation(() =>
				Promise.resolve(
					jsonResponse(404, { code: "NOT_FOUND", error: "No such organization" }),
				),
			);
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			fetchImpl,
		});

		await expect(client.getOrganization("missing")).rejects.toMatchObject({
			code: "NOT_FOUND",
			status: 404,
		});
		await expect(client.getOrganization("missing")).rejects.toBeInstanceOf(
			DpdpGuardApiError,
		);
	});

	test("createDsrRequest forwards an Idempotency-Key header when provided", async () => {
		const fetchImpl = jest.fn().mockResolvedValue(
			jsonResponse(201, {
				_id: "dsr_1",
				organizationId: "org_1",
				type: "erasure",
			}),
		);
		const client = new DpdpGuardClient({
			baseUrl: "https://example.convex.site",
			accessToken: "token-abc",
			fetchImpl,
		});

		await client.createDsrRequest(
			{ organizationId: "org_1", type: "erasure" },
			"idem-key-1",
		);

		const [, init] = fetchImpl.mock.calls[0];
		expect(init.headers["Idempotency-Key"]).toBe("idem-key-1");
	});

	test("has no brokerToken method — mobile apps must never hold the service API key", () => {
		const client = new DpdpGuardClient({ baseUrl: "https://example.convex.site" });
		expect((client as unknown as Record<string, unknown>).brokerToken).toBeUndefined();
	});
});
