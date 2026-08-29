# dpdpguard-react-native-sdk

DPDP Guard React Native SDK.

Package: `@dpdpguard/react-native`

Part of the DPDP Guard SDK family. See the design spec:
https://github.com/dpdp-guard-ai/dpdpbot/blob/main/docs/specs/mobile-server-sdk.md

## What's here vs. what's not

Two layers, with different requirements:

**The HTTP client** — a typed `DpdpGuardClient` over DPDP Guard's public
`/api/v1` (spec §4.2), following the same pattern as
`dpdpguard-server-sdk`/`dpdpguard-js-sdk` and `dpdpguard-flutter-sdk`.
Plain `fetch`, no native module involved; usable from any JS runtime.

**Offline consent capture** — the device-side half of
`docs/specs/offline-consent-capture.md` §4, matching what
`dpdpguard-ios-sdk` ships natively. This *does* need native code: consent
captured away from the network is signed by a key held in the device's
secure element, and the pending queue is encrypted at rest. It requires
React Native's new architecture.

The split matters for what gets written twice. **The `dpdpcca/2`
canonicalization lives only in JavaScript** (`src/offline/captureArtifact.ts`),
tested against `@dpdpguard/contract`'s golden vectors. The native modules
under `ios/` and `android/` do key storage, signing, and encrypted
persistence only. A second canonicalization in Swift and a third in Kotlin
could drift from the server's, and drift there means a legitimate consent
quarantining as `signature_mismatch` on sync — so there is exactly one.

This is a reversal of the position taken in `1.0.0`, which removed the
`create-react-native-library` turbo-module scaffold on the reasoning that
nothing here needed on-device native code. Offline capture does.

**Deliberately excluded, for security, not by omission:**

- **No `brokerToken()`.** Minting a brokered access token (ADR-004 D1/D2)
  requires a service API key (`convex/apiKeys.ts`), which must never ship
  inside a mobile app bundle — it's extractable from any app binary.
  Brokering stays server-side: your own backend holds the API key, calls
  DPDP Guard's `/api/v1/auth/broker-token`, and hands the resulting
  short-lived access token to the app. `DpdpGuardClient` takes that token
  via `setAccessToken()` / the constructor, nothing more.
- **No keyed audit hash, and no webhook-signature code.** Both require a
  secret the app must not hold (`DPDP_AUDIT_HASH_HMAC_SECRET` / a webhook
  endpoint's own secret) — server-only concerns, unsafe inside a mobile
  client. The *unkeyed* half of the audit hash is available as
  `canonicalAuditString()` (see [Audit-hash canonicalization](#audit-hash-canonicalization));
  it needs no secret.
- **No direct sync of offline captures.**
  `POST /api/v1/offline/captures` is declared `security: [apiKey]` — the
  same org-scoped service key `brokerToken()` would need. So
  `OfflineCaptureManager.syncPending()` takes a transport function you
  supply, which in practice POSTs the batch to your own backend to be
  forwarded with the key attached. Capture, signing, and queueing all
  happen on-device; only the final hop is brokered.

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

// Recording consent from a banner shown *before* login (ADR-004 D6) needs
// no auth either — just a client-generated anonymousId. Reconcile it into
// the signed-in user's profile later with linkAnonymousConsent().
await client.giveConsentAnonymous({
  organizationId: org.orgId,
  noticeId: notices[0]._id,
  purpose: 'Analytics',
  dataTypes: ['deviceId'],
  anonymousId,
});
```

Every non-2xx response throws a `DpdpGuardApiError` with a `code` from the
ADR-002 error catalog (`err.code`, e.g. `"NOT_FOUND"`) and the HTTP
`status`.

### Types

The wire types are generated from `@dpdpguard/contract`'s `openapi/v1.yaml`
and re-exported, so you can name what the client returns instead of
re-declaring it:

```ts
import type { DsrRequest, Notice, components } from '@dpdpguard/react-native';

const notice: Notice = await client.getNotice(noticeId);

// Endpoints this SDK deliberately doesn't wrap are still typed:
type GateDecision = components['schemas']['ConsentGateDecision'];
```

The contract version these were generated from is recorded in
`src/CONTRACT_VERSION`; `src/contractVersion.test.ts` fails if an install
drifts off it.

### Endpoints without a facade method

The DPDP Guard API is wider than the Data-Principal surface this SDK
curates. `call()` reaches the rest, with the same auth, URL joining, and
`DpdpGuardApiError` mapping as every other method:

```ts
import type { components } from '@dpdpguard/react-native';

type Decision = components['schemas']['ConsentGateDecision'];
const { decisions } = await client.call<{ decisions: Decision[] }>(
  'GET',
  '/api/v1/consent/gate/decisions?limit=50',
);
```

This widens reach, not privilege: the client still sends only the brokered
principal token, so org-scoped endpoints will correctly 401 from an app.

### Audit-hash canonicalization

`canonicalAuditString()` builds the `|`-joined canonical string that the
`consentAuditTrail.auditHash` is computed over
(`@dpdpguard/contract`'s `conformance/audit-hash-spec.md`), checked against
that package's golden vectors:

```ts
import { canonicalAuditString } from '@dpdpguard/react-native';

canonicalAuditString({
  organizationId: 'org_abc123',
  noticeId: 'notice_v1',
  noticeVersion: 1,
  purpose: 'Marketing',
  dataTypes: ['phone', 'email'], // sorted for you
  givenAt: 1700000001000,
  source: 'brokered',
});
// 'org_abc123|notice_v1|1|Marketing|email,phone|1700000001000|brokered'
```

The hash itself is `HMAC-SHA256` of this string under a secret that stays
server-side, so this package stops at the canonical form — hand it to your
backend to sign, or use it to check which event a hash your backend
returned refers to.

## Offline consent capture

For field agents, POS terminals, and IVR gateways capturing consent away
from the network (`docs/specs/offline-consent-capture.md` §4). Requires the
new architecture — the native module is autolinked; no manual step beyond
`pod install`.

### 1. Enroll the device, once

```ts
import { OfflineCaptureManager } from '@dpdpguard/react-native';

const offline = new OfflineCaptureManager({
  organizationId: 'org_abc123',
  deviceId: 'device_pune_114', // the agentDevices row for this device
});

const { publicKeySPKIBase64, hardwareBacked } = await offline.enroll();
```

The private key is generated inside the Secure Enclave (iOS) or
StrongBox/TEE (Android) and never leaves the device — this SDK cannot
transmit it. Register `publicKeySPKIBase64` on `agentDevices` through the
fleet-enrollment console flow; until you do, every capture from this device
quarantines as `unknown_device`.

Check `hardwareBacked` before allowing capture in production. It is `false`
on Simulators, emulators, and hardware with no secure element, where the
key is only software-protected — the server cannot tell the difference from
the signature alone, so this is the only place that decision can be made.

### 2. Capture, with no connectivity

```ts
const session = await offline.capture({
  noticeId: 'notice_v3',
  noticeVersion: 3,
  noticeLocale: 'hi', // the language actually rendered — s. 5(3) evidence
  purposeGrants: [
    { purposeKey: 'kyc_verification', purposeLabel: 'KYC', category: 'essential', status: 'opt_in' },
    { purposeKey: 'marketing', purposeLabel: 'Marketing', category: 'non_essential', status: 'opt_out' },
  ],
  dataTypes: ['pan', 'aadhaar'],
  principalHandle: { kind: 'phone_hash', value: '9876543210' },
  channel: 'agent_app',
});
```

Nothing here touches the network. Pass every purpose the principal was
*shown*, opted in or out: proving someone was shown marketing and refused
is what distinguishes granular consent from a notice that quietly omitted
it.

### 3. Sync when connectivity returns

`POST /api/v1/offline/captures` requires an org-scoped service API key,
which must never ship in an app bundle — so you supply the transport, and
it goes through your own backend:

```ts
const results = await offline.syncPending(async (body) => {
  const response = await fetch('https://my-backend.example/dpdp/offline-captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${myAppSessionToken}` },
    body: JSON.stringify(body), // forward verbatim; your backend adds the DPDP Guard API key
  });
  return response.json(); // { results: [...] }
});

for (const result of results) {
  if (result.status !== 'verified') {
    console.warn(`${result.clientSessionId}: ${result.status} — ${result.reason}`);
  }
}
```

**Partial success is normal.** A resolved promise does not mean every
capture committed — inspect each result. Batches are split at 200 sessions,
which is the endpoint's limit. Every acknowledged session is evicted from
the local store, including quarantined and rejected ones: those are
retained server-side as evidence (spec §4.4 — never silently dropped), so
keeping a local copy would only mean resubmitting them forever.

A `withdrawalToken` on a verified result is what makes the consent
withdrawable under s. 6(4) — print it on the slip or read it out.

### What the device signs

`capture()` builds the `dpdpcca/2` canonical string
(`conformance/audit-hash-spec.md`) and has the secure element sign its
UTF-8 bytes with ECDSA P-256 / SHA-256. The server recomputes that string
at sync and verifies it, so the canonicalization is exact: token lengths in
UTF-8 bytes, byte-wise sorts, explicit list counts. It is implemented once,
in JavaScript, and checked against the contract's golden vectors —
`canonicalCaptureString()` is exported if you need to re-derive it.

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
