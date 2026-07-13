/**
 * "Internal Services API" layer.
 *
 * This is the only layer that ever touches data. Tools (src/tools) call these
 * functions — never SQL, never the raw arrays in mockDb.ts directly. In
 * production these functions become HTTP calls to HobbyFi's existing
 * Bookings / Memberships / Payments / Users services.
 *
 * Every function is scoped by vendorId, taken from the authenticated
 * session — never from anything the model outputs — which is what makes
 * cross-vendor data leakage structurally impossible rather than
 * prompt-discouraged.
 */
import {
  activities,
  bookings,
  memberships,
  transactions,
  users,
  venues,
  vendors,
  type Membership,
} from "../data/mockDb.js";

function assertVendor(vendorId: string) {
  const vendor = vendors.find((v) => v.vendorId === vendorId);
  if (!vendor) throw new Error(`Unknown vendor: ${vendorId}`);
  return vendor;
}

function activityByName(vendorId: string, activityName?: string) {
  if (!activityName) return undefined;
  const vendorVenueIds = venues.filter((v) => v.vendorId === vendorId).map((v) => v.venueId);
  return activities.find(
    (a) => vendorVenueIds.includes(a.venueId) && a.name.toLowerCase() === activityName.toLowerCase()
  );
}

// ---- READS -------------------------------------------------------------

export function getRevenue(vendorId: string, dateRange: { from: string; to: string }) {
  assertVendor(vendorId);
  const inRange = transactions.filter(
    (t) => t.vendorId === vendorId && t.status === "success" && t.createdAt.slice(0, 10) >= dateRange.from && t.createdAt.slice(0, 10) <= dateRange.to
  );
  const total = inRange.reduce((sum, t) => sum + t.amount, 0);
  return { vendorId, from: dateRange.from, to: dateRange.to, totalRevenue: total, transactionCount: inRange.length };
}

export function listTrialUsers(vendorId: string, activityName?: string) {
  assertVendor(vendorId);
  const activity = activityByName(vendorId, activityName);
  const rows = memberships.filter(
    (m) => m.vendorId === vendorId && m.status === "trial" && (!activity || m.activityId === activity.activityId)
  );
  return rows.map((m) => {
    const user = users.find((u) => u.userId === m.userId)!;
    const act = activities.find((a) => a.activityId === m.activityId)!;
    return {
      membershipId: m.membershipId,
      userId: user.userId,
      userName: user.name,
      activity: act.name,
      trialStart: m.startDate,
      trialEnd: m.endDate,
    };
  });
}

export function listBookings(vendorId: string, opts: { activityName?: string; from?: string; to?: string } = {}) {
  assertVendor(vendorId);
  const activity = activityByName(vendorId, opts.activityName);
  return bookings
    .filter(
      (b) =>
        b.vendorId === vendorId &&
        (!activity || b.activityId === activity.activityId) &&
        (!opts.from || b.slotDate >= opts.from) &&
        (!opts.to || b.slotDate <= opts.to)
    )
    .map((b) => {
      const user = users.find((u) => u.userId === b.userId)!;
      const venue = venues.find((v) => v.venueId === b.venueId)!;
      return { bookingId: b.bookingId, userName: user.name, venue: venue.name, date: b.slotDate, time: b.slotTime, amount: b.amount, status: b.status };
    });
}

/** Entity resolution helper used by the Action agent + working memory. */
export function findMembershipByUserName(vendorId: string, userName: string): Membership[] {
  assertVendor(vendorId);
  const matches = users.filter((u) => u.name.toLowerCase().includes(userName.toLowerCase()));
  return memberships.filter((m) => m.vendorId === vendorId && matches.some((u) => u.userId === m.userId));
}

export function getMembership(vendorId: string, membershipId: string) {
  assertVendor(vendorId);
  const m = memberships.find((mm) => mm.membershipId === membershipId && mm.vendorId === vendorId);
  if (!m) throw new Error(`Membership ${membershipId} not found for vendor ${vendorId}`);
  const user = users.find((u) => u.userId === m.userId)!;
  return { ...m, userName: user.name };
}

/** Entity resolution for refunds: find a user's successful transactions by name. */
export function findTransactionsByUserName(vendorId: string, userName: string) {
  assertVendor(vendorId);
  const matches = users.filter((u) => u.name.toLowerCase().includes(userName.toLowerCase()));
  const matchIds = new Set(matches.map((u) => u.userId));
  const userBookingIds = new Set(bookings.filter((b) => matchIds.has(b.userId)).map((b) => b.bookingId));
  return transactions
    .filter((t) => t.vendorId === vendorId && t.status === "success" && t.bookingId && userBookingIds.has(t.bookingId))
    .map((t) => {
      const booking = bookings.find((b) => b.bookingId === t.bookingId)!;
      const user = users.find((u) => u.userId === booking.userId)!;
      const venue = venues.find((v) => v.venueId === booking.venueId)!;
      return { txnId: t.txnId, userName: user.name, venue: venue.name, date: booking.slotDate, amount: t.amount };
    });
}

// ---- WRITES (real mutation functions — only ever invoked by the workflow's
// privileged execute step, AFTER vendor approval, never directly by an agent) ---

export function applyExtendTrial(vendorId: string, membershipId: string, extraDays: number) {
  const m = memberships.find((mm) => mm.membershipId === membershipId && mm.vendorId === vendorId);
  if (!m) throw new Error(`Membership ${membershipId} not found for vendor ${vendorId}`);
  const before = { ...m };
  const newEnd = new Date(m.endDate);
  newEnd.setDate(newEnd.getDate() + extraDays);
  m.endDate = newEnd.toISOString().slice(0, 10);
  return { before, after: { ...m } };
}

export function applyUpdateMembershipDate(vendorId: string, membershipId: string, newEndDate: string) {
  const m = memberships.find((mm) => mm.membershipId === membershipId && mm.vendorId === vendorId);
  if (!m) throw new Error(`Membership ${membershipId} not found for vendor ${vendorId}`);
  const before = { ...m };
  m.endDate = newEndDate;
  return { before, after: { ...m } };
}

export function getTransaction(vendorId: string, txnId: string) {
  const t = transactions.find((tt) => tt.txnId === txnId && tt.vendorId === vendorId);
  if (!t) throw new Error(`Transaction ${txnId} not found for vendor ${vendorId}`);
  return t;
}

export function applyRefund(vendorId: string, txnId: string, amount: number) {
  const t = getTransaction(vendorId, txnId);
  if (amount > t.amount) throw new Error(`Refund amount ₹${amount} exceeds transaction amount ₹${t.amount}`);
  const before = { ...t };
  t.status = "refunded";
  return { before, after: { ...t } };
}