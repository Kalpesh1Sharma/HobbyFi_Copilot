/**
 * Mock data layer for the HobbyFi Copilot demo.
 *
 * In production this file doesn't exist — these shapes are served by HobbyFi's
 * real backend services (Bookings, Memberships, Payments, Users, Venues).
 * The Copilot's tools (see src/tools) only ever talk to that service layer,
 * never to a database directly. This module stands in for that service layer
 * so the whole system is runnable without any external infra.
 */

export type Vendor = {
  vendorId: string;
  name: string;
  city: string;
  category: string;
  status: "active" | "suspended";
};

export type Venue = {
  venueId: string;
  vendorId: string;
  name: string;
  address: string;
};

export type Activity = {
  activityId: string;
  venueId: string;
  name: string; // e.g. "Badminton"
  type: "court" | "class";
};

export type User = {
  userId: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  joinedAt: string; // ISO date
};

export type Membership = {
  membershipId: string;
  userId: string;
  vendorId: string;
  activityId: string;
  planType: "trial" | "monthly" | "quarterly" | "annual";
  status: "trial" | "active" | "expired" | "cancelled";
  startDate: string; // ISO date
  endDate: string; // ISO date
};

export type Booking = {
  bookingId: string;
  userId: string;
  vendorId: string;
  venueId: string;
  activityId: string;
  slotDate: string; // ISO date
  slotTime: string; // HH:mm
  amount: number; // INR
  splitCount: number;
  status: "confirmed" | "completed" | "cancelled";
};

export type Transaction = {
  txnId: string;
  vendorId: string;
  bookingId?: string;
  membershipId?: string;
  amount: number; // INR
  method: "UPI" | "card" | "netbanking";
  status: "success" | "refunded" | "failed";
  createdAt: string; // ISO datetime
};

// ---- Seed data --------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

export const vendors: Vendor[] = [
  { vendorId: "vnd_001", name: "Smash Arena", city: "Bengaluru", category: "Badminton", status: "active" },
  { vendorId: "vnd_002", name: "Zenith Yoga Studio", city: "Mumbai", category: "Yoga", status: "active" },
];

export const venues: Venue[] = [
  { venueId: "ven_001", vendorId: "vnd_001", name: "Smash Arena - Koramangala", address: "80 Feet Rd, Koramangala, Bengaluru" },
  { venueId: "ven_002", vendorId: "vnd_001", name: "Smash Arena - Indiranagar", address: "100 Feet Rd, Indiranagar, Bengaluru" },
  { venueId: "ven_003", vendorId: "vnd_002", name: "Zenith Yoga - Bandra", address: "Linking Rd, Bandra, Mumbai" },
];

export const activities: Activity[] = [
  { activityId: "act_001", venueId: "ven_001", name: "Badminton", type: "court" },
  { activityId: "act_002", venueId: "ven_002", name: "Badminton", type: "court" },
  { activityId: "act_003", venueId: "ven_003", name: "Yoga", type: "class" },
  { activityId: "act_004", venueId: "ven_003", name: "Zumba", type: "class" },
];

export const users: User[] = [
  { userId: "usr_001", name: "Rohit Kumar", phone: "+91-90000-00001", email: "rohit.k@example.com", city: "Jaipur", joinedAt: "2026-05-02" },
  { userId: "usr_002", name: "Aisha Khan", phone: "+91-90000-00002", email: "aisha.k@example.com", city: "Bengaluru", joinedAt: "2026-06-11" },
  { userId: "usr_003", name: "Arjun Mehta", phone: "+91-90000-00003", email: "arjun.m@example.com", city: "Bengaluru", joinedAt: "2026-04-20" },
  { userId: "usr_004", name: "Priya Sharma", phone: "+91-90000-00004", email: "priya.s@example.com", city: "Mumbai", joinedAt: "2026-03-15" },
  { userId: "usr_005", name: "Meera Iyer", phone: "+91-90000-00005", email: "meera.i@example.com", city: "Chennai", joinedAt: "2026-06-30" },
];

export const memberships: Membership[] = [
  { membershipId: "mem_001", userId: "usr_002", vendorId: "vnd_001", activityId: "act_001", planType: "trial", status: "trial", startDate: "2026-07-05", endDate: "2026-07-12" },
  { membershipId: "mem_002", userId: "usr_003", vendorId: "vnd_001", activityId: "act_002", planType: "trial", status: "trial", startDate: "2026-07-08", endDate: "2026-07-15" },
  { membershipId: "mem_003", userId: "usr_001", vendorId: "vnd_001", activityId: "act_001", planType: "monthly", status: "active", startDate: "2026-06-01", endDate: "2026-07-30" },
  { membershipId: "mem_004", userId: "usr_004", vendorId: "vnd_002", activityId: "act_003", planType: "trial", status: "trial", startDate: "2026-07-10", endDate: "2026-07-17" },
  { membershipId: "mem_005", userId: "usr_005", vendorId: "vnd_002", activityId: "act_004", planType: "monthly", status: "active", startDate: "2026-06-15", endDate: "2026-07-15" },
];

export const bookings: Booking[] = [
  { bookingId: "bkg_001", userId: "usr_001", vendorId: "vnd_001", venueId: "ven_001", activityId: "act_001", slotDate: TODAY, slotTime: "18:00", amount: 600, splitCount: 4, status: "confirmed" },
  { bookingId: "bkg_002", userId: "usr_002", vendorId: "vnd_001", venueId: "ven_001", activityId: "act_001", slotDate: TODAY, slotTime: "07:00", amount: 500, splitCount: 2, status: "completed" },
  { bookingId: "bkg_003", userId: "usr_003", vendorId: "vnd_001", venueId: "ven_002", activityId: "act_002", slotDate: YESTERDAY, slotTime: "19:00", amount: 550, splitCount: 3, status: "completed" },
  { bookingId: "bkg_004", userId: "usr_004", vendorId: "vnd_002", venueId: "ven_003", activityId: "act_003", slotDate: TODAY, slotTime: "09:00", amount: 800, splitCount: 1, status: "confirmed" },
];

export const transactions: Transaction[] = [
  { txnId: "txn_001", vendorId: "vnd_001", bookingId: "bkg_001", amount: 600, method: "UPI", status: "success", createdAt: `${TODAY}T06:15:00Z` },
  { txnId: "txn_002", vendorId: "vnd_001", bookingId: "bkg_002", amount: 500, method: "card", status: "success", createdAt: `${TODAY}T01:35:00Z` },
  { txnId: "txn_003", vendorId: "vnd_001", bookingId: "bkg_003", amount: 550, method: "UPI", status: "success", createdAt: `${YESTERDAY}T13:20:00Z` },
  { txnId: "txn_004", vendorId: "vnd_002", bookingId: "bkg_004", amount: 800, method: "netbanking", status: "success", createdAt: `${TODAY}T03:40:00Z` },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  // `npm run seed:print` — quick visual sanity check of the mock data.
  console.log(JSON.stringify({ vendors, venues, activities, users, memberships, bookings, transactions }, null, 2));
}
