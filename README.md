# dpdpguard-react-native-sdk

DPDP Guard React Native SDK.

Package: `@dpdpguard/react-native`

Part of the DPDP Guard SDK family. See the design spec:
https://github.com/dpdp-guard-ai/dpdpbot/blob/main/docs/specs/mobile-server-sdk.md

## What's here vs. what's not

This repo was scaffolded as a `create-react-native-library` turbo-module
(`multiply()` native stub, Android/iOS native folders) intended to
eventually bridge over native Android/iOS consent engines (ADR-005) — that
native bridge is **not built yet**; it depends on the native
`dpdpguard-android-sdk`/`dpdpguard-ios-sdk` consent engines (ADR-003)
existing first, which they don't.

What's implemented now is the **HTTP client layer**: a typed
`DpdpGuardClient` over DPDP Guard's public `/api/v1` (spec §4.2), following
the same pattern as `dpdpguard-server-sdk`/`dpdpguard-js-sdk` — usable
today from RN app code via plain `fetch`, with no native module involved.

**Deliberately excluded, for security, not by omission:**

- **No `brokerToken()`.** Minting a brokered access token (ADR-004 D1/D2)
  requires a service API key (`convex/apiKeys.ts`), which must never ship
  inside a mobile app bundle — it's extractable from any app binary.
  Brokering stays server-side: your own backend holds the API key, calls
  DPDP Guard's `/api/v1/auth/broker-token`, and hands the resulting
  short-lived access token to the app. `DpdpGuardClient` takes that token
  via `setAccessToken()` / the constructor, nothing more.
- **No audit-hash or webhook-signature code.** Both require the
  platform's HMAC secret (`DPDP_AUDIT_HASH_HMAC_SECRET` /
  a webhook endpoint's own secret) — server-only concerns, irrelevant to
  and unsafe inside a mobile client.

## Usage

```ts
import { DpdpGuardClient, hasConsent } from '@dpdpguard/react-native';

const client = new DpdpGuardClient({
  baseUrl: 'https://<your-deployment>.convex.site',
});

// Get a token from YOUR OWN backend (which holds the service API key and
// calls /api/v1/auth/broker-token), then:
client.setAccessToken(tokenFromMyBackend);

const { requests } = await client.listDsrRequests();
await client.createDsrRequest({ organizationId, type: 'erasure' });

// Public reads need no auth at all.
const org = await client.getOrganization('acme');
const { notices } = await client.getNotices(org.orgId);
```

Every non-2xx response throws a `DpdpGuardApiError` with a `code` from the
ADR-002 error catalog (`err.code`, e.g. `"NOT_FOUND"`) and the HTTP
`status`.

## Contract

Depends on
[`@dpdpguard/contract`](https://www.npmjs.com/package/@dpdpguard/contract)
(ADR-001/002):

- `src/generated/api-types.ts` is regenerated from the installed
  contract's `openapi/v1.yaml` via `openapi-typescript`
  (`npm run codegen`, also run automatically on `npm install` via
  `postinstall`). Gitignored — never hand-edited.
- `src/errorCatalog.ts` statically imports
  `@dpdpguard/contract/conformance/error-catalog.json` (ADR-002 D2) — no
  dynamic `require()` trick needed here, unlike the Node server SDK,
  since Metro and TypeScript's `resolveJsonModule` both support importing
  JSON directly.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run codegen` | Regenerate `src/generated/api-types.ts` from the installed contract |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Jest test suite |

**Not yet wired:** a real library build/bundle step (the scaffold's
`create-react-native-library` metadata lists `vite` as a chosen tool, but
no bundler config exists) and npm publish credentials — same gap as the
other SDK packages before their first release.
