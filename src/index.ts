export { DpdpGuardClient } from './client';
export type { DpdpGuardClientOptions } from './client';
export { DpdpGuardApiError, ERROR_CATALOG } from './errorCatalog';
export type { ApiErrorCode, ErrorCatalogEntry } from './errorCatalog';
export { hasConsent } from './consentGate';
export type { ConsentRecord } from './consentGate';

// The openapi-typescript output generated from the installed
// @dpdpguard/contract's openapi/v1.yaml, re-exported so consumers can name
// the wire types this client returns (and reach endpoints `DpdpGuardClient`
// deliberately doesn't wrap) instead of re-declaring them by hand. Mirrors
// dpdpguard-ios-sdk, which exposes its whole generated `DPDPGuardConsentAPI`
// target alongside the hand-written facade.
export type {
	components,
	operations,
	paths,
} from './generated/api-types';

import type { components } from './generated/api-types';

export type OrgSummary = components['schemas']['OrgSummary'];
export type Notice = components['schemas']['Notice'];
export type DsrRequest = components['schemas']['DsrRequest'];
export type Grievance = components['schemas']['Grievance'];
export type Nomination = components['schemas']['Nomination'];
export type ApiError = components['schemas']['ApiError'];
/**
 * The wire-level consent record from `/cm/v1/consent`. Distinct from this
 * package's own {@link ConsentRecord}, which is the minimal shape
 * {@link hasConsent} gates on.
 */
export type ApiConsentRecord = components['schemas']['ConsentRecord'];
