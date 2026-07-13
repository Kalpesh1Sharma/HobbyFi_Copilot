/**
 * Business-rule guardrails, checked BEFORE a write action is even proposed
 * to the vendor. These are plain deterministic functions — not prompts —
 * so they can't be argued around by the model or the person typing.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

export const LIMITS = {
  MAX_TRIAL_EXTENSION_DAYS: 30,
  MAX_REFUND_WITHOUT_SECOND_APPROVER: 5000, // INR
};

export function checkTrialExtension(extraDays: number): GuardResult {
  if (!Number.isFinite(extraDays) || extraDays <= 0) {
    return { ok: false, reason: "Extension must be a positive number of days." };
  }
  if (extraDays > LIMITS.MAX_TRIAL_EXTENSION_DAYS) {
    return {
      ok: false,
      reason: `Trial extensions are capped at ${LIMITS.MAX_TRIAL_EXTENSION_DAYS} days per action. Requested ${extraDays} days — please split this into multiple approvals or contact HobbyFi support for an exception.`,
    };
  }
  return { ok: true };
}

export function checkMembershipDate(newEndDate: string): GuardResult {
  const today = new Date().toISOString().slice(0, 10);
  if (newEndDate < today) {
    return { ok: false, reason: `New end date ${newEndDate} is in the past. Membership end dates cannot be backdated.` };
  }
  return { ok: true };
}

export function checkRefund(amount: number, txnAmount: number): GuardResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Refund amount must be positive." };
  }
  if (amount > txnAmount) {
    return { ok: false, reason: `Refund amount ₹${amount} exceeds the original transaction amount ₹${txnAmount}.` };
  }
  if (amount > LIMITS.MAX_REFUND_WITHOUT_SECOND_APPROVER) {
    return {
      ok: false,
      reason: `Refunds above ₹${LIMITS.MAX_REFUND_WITHOUT_SECOND_APPROVER} require a second approver (owner/admin role) — this demo only supports single-approver flow, so this action is blocked rather than silently downgraded.`,
    };
  }
  return { ok: true };
}
