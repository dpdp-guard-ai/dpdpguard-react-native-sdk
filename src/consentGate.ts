/**
 * Pure helper for gating a feature/tracker on an existing consent decision —
 * e.g. `if (!hasConsent(consents, "Analytics")) return;` before firing an
 * analytics event.
 */
export interface ConsentRecord {
	purpose: string;
	/** Present when the decision was withdrawn; absent/undefined means still active. */
	withdrawnAt?: number | null;
}

export function hasConsent(consents: ConsentRecord[], purpose: string): boolean {
	return consents.some((c) => c.purpose === purpose && c.withdrawnAt == null);
}
