/**
 * Tool catalog exposed to the agents.
 *
 * READ tools call the service layer directly and return real data — no
 * approval needed.
 *
 * WRITE tools' `execute` ONLY returns a proposed diff — it never calls the
 * `apply*` mutation functions in vendorApi.ts. The actual mutation is
 * performed by a separate, privileged step in the workflow (src/workflow)
 * that runs only after the vendor approves, which is what makes "the LLM
 * can propose a write but cannot perform one" a structural guarantee rather
 * than a prompted-for behaviour.
 *
 * Note: Mastra's `createTool` also has a native `requireApproval` flag that
 * pauses the agent's own tool-calling loop pending approval. We deliberately
 * DON'T use it here — the workflow-level suspend/resume gate in
 * copilotWorkflow.ts already implements this, and the two mechanisms don't
 * compose without also wiring up `requireToolApproval` + the
 * approve/declineToolCall handshake on every `generate()` call. Keeping the
 * approval gate at the workflow level (rather than split across two
 * different suspend mechanisms) keeps the "propose vs execute" boundary in
 * one place.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as api from "../services/vendorApi.js";
import { checkTrialExtension, checkMembershipDate, checkRefund } from "../guardrails/rules.js";

// ---- READ TOOLS ----------------------------------------------------------

export const getRevenueTool = createTool({
  id: "getRevenue",
  description: "Get total revenue and transaction count for the vendor over a date range (inclusive, YYYY-MM-DD).",
  inputSchema: z.object({
    from: z.string().describe("Start date, YYYY-MM-DD"),
    to: z.string().describe("End date, YYYY-MM-DD"),
  }),
  outputSchema: z.object({
    vendorId: z.string(),
    from: z.string(),
    to: z.string(),
    totalRevenue: z.number(),
    transactionCount: z.number(),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    return api.getRevenue(vendorId, { from: inputData.from, to: inputData.to });
  },
});

export const listTrialUsersTool = createTool({
  id: "listTrialUsers",
  description: "List users currently on a free trial for this vendor, optionally filtered by activity name (e.g. 'Badminton').",
  inputSchema: z.object({
    activityName: z.string().optional().describe("e.g. 'Badminton', 'Yoga' — omit to list all trial users"),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    return api.listTrialUsers(vendorId, inputData.activityName);
  },
});

export const listBookingsTool = createTool({
  id: "listBookings",
  description: "List bookings for this vendor, optionally filtered by activity name and/or date range (YYYY-MM-DD).",
  inputSchema: z.object({
    activityName: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    return api.listBookings(vendorId, inputData);
  },
});

export const findUserTool = createTool({
  id: "findUser",
  description: "Find a user's membership(s) with this vendor by (partial) name — used to resolve which user/membership a write action should target.",
  inputSchema: z.object({ userName: z.string() }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    return api.findMembershipByUserName(vendorId, inputData.userName);
  },
});

// ---- WRITE TOOLS (proposal-only, require approval) ------------------------

export const extendTrialTool = createTool({
  id: "extendTrial",
  description:
    "Propose extending a user's free trial by N days. Does NOT apply the change — returns a proposal for vendor approval. Requires the exact membershipId (use findUser first to resolve it).",
  inputSchema: z.object({
    membershipId: z.string(),
    extraDays: z.number().int().positive(),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    const guard = checkTrialExtension(inputData.extraDays);
    const membership = api.getMembership(vendorId, inputData.membershipId);
    if (!guard.ok) {
      return { proposal: false as const, blocked: true, reason: guard.reason };
    }
    const newEnd = new Date(membership.endDate);
    newEnd.setDate(newEnd.getDate() + inputData.extraDays);
    return {
      proposal: true as const,
      blocked: false,
      tool: "extendTrial",
      params: inputData,
      summary: `Extend ${membership.userName}'s trial by ${inputData.extraDays} day(s)`,
      before: { endDate: membership.endDate },
      after: { endDate: newEnd.toISOString().slice(0, 10) },
    };
  },
});

export const updateMembershipDateTool = createTool({
  id: "updateMembershipDate",
  description:
    "Propose changing a membership's end date. Does NOT apply the change — returns a proposal for vendor approval. Requires the exact membershipId (use findUser first to resolve it).",
  inputSchema: z.object({
    membershipId: z.string(),
    newEndDate: z.string().describe("YYYY-MM-DD"),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    const guard = checkMembershipDate(inputData.newEndDate);
    const membership = api.getMembership(vendorId, inputData.membershipId);
    if (!guard.ok) {
      return { proposal: false as const, blocked: true, reason: guard.reason };
    }
    return {
      proposal: true as const,
      blocked: false,
      tool: "updateMembershipDate",
      params: inputData,
      summary: `Change ${membership.userName}'s membership end date`,
      before: { endDate: membership.endDate },
      after: { endDate: inputData.newEndDate },
    };
  },
});

export const issueRefundTool = createTool({
  id: "issueRefund",
  description:
    "Propose a refund for a transaction. Does NOT apply the refund — returns a proposal for vendor approval. Requires the exact transaction id.",
  inputSchema: z.object({
    txnId: z.string(),
    amount: z.number().positive(),
    reason: z.string(),
  }),
  execute: async (inputData, context) => {
    const requestContext = context?.requestContext;
    const vendorId = requestContext?.get("vendorId") as string;
    const txn = api.getTransaction(vendorId, inputData.txnId);
    const guard = checkRefund(inputData.amount, txn.amount);
    if (!guard.ok) {
      return { proposal: false as const, blocked: true, reason: guard.reason };
    }
    return {
      proposal: true as const,
      blocked: false,
      tool: "issueRefund",
      params: inputData,
      summary: `Refund ₹${inputData.amount} for transaction ${inputData.txnId} (${inputData.reason})`,
      before: { status: txn.status },
      after: { status: "refunded" },
    };
  },
});

export const readTools = { getRevenueTool, listTrialUsersTool, listBookingsTool, findUserTool };
export const writeTools = { extendTrialTool, updateMembershipDateTool, issueRefundTool };
// The action agent needs findUser too, to resolve "Aisha" -> a membershipId
// before it can call a write tool — it's a lookup, not a mutation, so it's
// safe to share rather than duplicate.
export const actionAgentTools = { findUserTool, ...writeTools };
