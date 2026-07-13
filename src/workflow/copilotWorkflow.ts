/**
 * The Copilot workflow (see design report §6, Workflow Orchestration).
 *
 * Single suspendable step, deliberately:
 *   1st call  (no resumeData) -> classify intent -> either answer directly
 *             (read) or produce a validated proposal and suspend (write).
 *   2nd call  (resumeData present, i.e. after `run.resume(...)`) -> if
 *             approved, perform the REAL mutation via the service layer
 *             (never via the LLM) and audit-log it; if declined, audit-log
 *             the rejection and change nothing.
 *
 * Splitting "propose" and "execute" across the suspend boundary is what
 * makes human approval a structural gate rather than a prompt instruction —
 * the workflow engine itself won't continue past `suspend()` until the
 * vendor's decision comes back in.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { RequestContext } from "@mastra/core/di";
import { z } from "zod";
import { analyticsAgent, actionAgent, actionExtractionSchema } from "../agents/agents.js";
import { extendTrialTool, updateMembershipDateTool, issueRefundTool } from "../tools/tools.js";
import { classifyIntent } from "./router.js";
import { appendAudit } from "../audit/auditLog.js";
import { setLastEntity } from "../memory/workingMemory.js";
import { getHistory, pushTurns, setAwaitingWriteFollowup } from "../memory/conversationHistory.js";
import * as api from "../services/vendorApi.js";
import { checkRefund } from "../guardrails/rules.js";
import { randomUUID } from "node:crypto";

const inputSchema = z.object({
  vendorId: z.string(),
  sessionId: z.string(),
  message: z.string(),
});

const outputSchema = z.object({
  kind: z.enum(["answer", "write_result", "declined", "blocked"]),
  text: z.string(),
});

const resumeSchema = z.object({
  approved: z.boolean(),
});

const suspendSchema = z.object({
  summary: z.string(),
  tool: z.enum(["extendTrial", "updateMembershipDate", "issueRefund"]),
  params: z.record(z.any()),
  before: z.record(z.any()).optional(),
  after: z.record(z.any()).optional(),
});

const WRITE_TOOL_NAMES = ["extendTrial", "updateMembershipDate", "issueRefund"] as const;

/**
 * Shared tail end of the propose step, once a write tool's execute() has
 * already run and returned either a blocked reason or a validated diff.
 * `suspend` is threaded through from the step's execute closure since it's
 * only available there.
 */
async function finishProposal(
  vendorId: string,
  sessionId: string,
  toolName: (typeof WRITE_TOOL_NAMES)[number],
  proposalResult: any,
  suspend: (payload: any) => any
) {
  if (proposalResult.blocked) {
    appendAudit({
      actionId: randomUUID(), vendorId, intentType: "write", toolName,
      params: proposalResult.params ?? {}, approvalStatus: "failed",
      message: proposalResult.reason, createdAt: new Date().toISOString(),
    });
    setAwaitingWriteFollowup(sessionId, false);
    return { kind: "blocked" as const, text: proposalResult.reason };
  }

  setLastEntity(sessionId, {
    type: "membership",
    id: proposalResult.params.membershipId ?? proposalResult.params.txnId,
    label: proposalResult.summary,
  });

  appendAudit({
    actionId: randomUUID(), vendorId, intentType: "write", toolName,
    params: proposalResult.params, before: proposalResult.before, after: proposalResult.after,
    approvalStatus: "proposed", createdAt: new Date().toISOString(),
  });

  setAwaitingWriteFollowup(sessionId, false);
  return await suspend({
    summary: proposalResult.summary,
    tool: toolName,
    params: proposalResult.params,
    before: proposalResult.before,
    after: proposalResult.after,
  });
}

const copilotStep = createStep({
  id: "copilotStep",
  inputSchema,
  outputSchema,
  resumeSchema,
  suspendSchema,
  execute: async ({ inputData, resumeData, suspendData, suspend }) => {
    const { vendorId, sessionId, message } = inputData;
    const requestContext = new RequestContext([["vendorId", vendorId]]);
    const today = new Date().toISOString().slice(0, 10);

    // ---- Phase 2: resumed after the vendor approved/declined ------------
    if (resumeData) {
      setAwaitingWriteFollowup(sessionId, false);
      const proposal = suspendData!; // the exact payload we suspended with

      if (!resumeData.approved) {
        appendAudit({
          actionId: randomUUID(),
          vendorId,
          intentType: "write",
          toolName: proposal.tool,
          params: proposal.params,
          approvalStatus: "rejected",
          createdAt: new Date().toISOString(),
        });
        return { kind: "declined" as const, text: "Got it — no changes made." };
      }

      try {
        let before: unknown, after: unknown, confirmText: string;

        if (proposal.tool === "extendTrial") {
          const r = api.applyExtendTrial(vendorId, proposal.params.membershipId, proposal.params.extraDays);
          before = r.before; after = r.after;
          confirmText = `Done — trial extended to ${r.after.endDate}.`;
        } else if (proposal.tool === "updateMembershipDate") {
          const r = api.applyUpdateMembershipDate(vendorId, proposal.params.membershipId, proposal.params.newEndDate);
          before = r.before; after = r.after;
          confirmText = `Done — membership end date updated to ${r.after.endDate}.`;
        } else {
          // issueRefund — re-validate against the REAL transaction amount right
          // before applying, since the tool-time check only had the requested
          // amount. This guard runs BEFORE any mutation (read-only lookup first),
          // matching the "validate, then commit" ordering a real DB transaction
          // would enforce.
          const txn = api.getTransaction(vendorId, proposal.params.txnId);
          const guard = checkRefund(proposal.params.amount, txn.amount);
          if (!guard.ok) {
            appendAudit({
              actionId: randomUUID(), vendorId, intentType: "write", toolName: proposal.tool,
              params: proposal.params, approvalStatus: "failed",
              message: guard.reason, createdAt: new Date().toISOString(),
            });
            return { kind: "blocked" as const, text: guard.reason };
          }
          const r = api.applyRefund(vendorId, proposal.params.txnId, proposal.params.amount);
          before = r.before; after = r.after;
          confirmText = `Done — ₹${proposal.params.amount} refunded for transaction ${proposal.params.txnId}.`;
        }

        appendAudit({
          actionId: randomUUID(),
          vendorId,
          intentType: "write",
          toolName: proposal.tool,
          params: proposal.params,
          before,
          after,
          approvalStatus: "executed",
          createdAt: new Date().toISOString(),
        });
        return { kind: "write_result" as const, text: confirmText };
      } catch (err) {
        appendAudit({
          actionId: randomUUID(), vendorId, intentType: "write", toolName: proposal.tool,
          params: proposal.params, approvalStatus: "failed",
          message: String(err), createdAt: new Date().toISOString(),
        });
        return { kind: "blocked" as const, text: `Couldn't apply that change: ${String((err as Error).message || err)}` };
      }
    }

    // ---- Phase 1: first pass — classify, then read or propose -----------
    const intent = classifyIntent(message, sessionId);
    const dated = (text: string) => `[Today: ${today}] ${text}`;

    if (intent === "read") {
      const priorTurns = getHistory(sessionId, "read");
      const userTurn = { role: "user" as const, content: dated(message) };
      const result = await analyticsAgent.generate([...priorTurns, userTurn] as any, { requestContext });
      pushTurns(sessionId, "read", [userTurn, { role: "assistant", content: result.text }]);
      appendAudit({
        actionId: randomUUID(), vendorId, intentType: "read", toolName: "analyticsAgent",
        params: { message }, approvalStatus: "n/a", createdAt: new Date().toISOString(),
      });
      const text = result.text?.trim() ? result.text : "Sorry, I couldn't find an answer to that — could you rephrase it?";
      return { kind: "answer" as const, text };
    }

    // write path — carries its own conversation history so a clarifying
    // question ("which Aisha?") and the vendor's short reply ("the one on
    // the badminton trial") stay part of the same exchange.
    //
    // Design note: this does NOT rely on the LLM to call tools. Tool-calling
    // reliability for gpt-oss-120b on Groq turned out to be too inconsistent
    // for a write path (see agents.ts for the full story — toolChoice, retry
    // nudges, and a model swap were all tried and none were sufficient).
    // Structured JSON extraction is far more reliable, so actionAgent only
    // extracts intent; everything from entity resolution onward is
    // deterministic code below, reusing the same proposal-only tool
    // `execute` functions — just invoked directly instead of via LLM choice.
    const priorTurns = getHistory(sessionId, "write");
    const userTurn = { role: "user" as const, content: dated(message) };
    const extractionResult = await actionAgent.generate([...priorTurns, userTurn] as any, {
      requestContext,
      structuredOutput: { schema: actionExtractionSchema },
    });
    const extracted = extractionResult.object;
    pushTurns(sessionId, "write", [
      userTurn,
      { role: "assistant", content: extracted.needsClarification ? extracted.clarifyingQuestion ?? "" : `[extracted: ${extracted.action} for ${extracted.personName}]` },
    ]);

    if (extracted.needsClarification || !extracted.action || !extracted.personName) {
      setAwaitingWriteFollowup(sessionId, true);
      const text = extracted.clarifyingQuestion?.trim()
        || "Sorry, I couldn't work out how to act on that. Could you rephrase, e.g. \"extend <name>'s trial by <N> days\"?";
      return { kind: "answer" as const, text };
    }

    // --- Deterministic entity resolution -----------------------------
    const toolName = extracted.action;
    const requestCtxAny = { requestContext } as any;

    if (toolName === "issueRefund") {
      const matches = api.findTransactionsByUserName(vendorId, extracted.personName);
      if (matches.length === 0) {
        setAwaitingWriteFollowup(sessionId, true);
        return { kind: "answer" as const, text: `I couldn't find a transaction for "${extracted.personName}" — could you check the spelling or give more detail?` };
      }
      if (matches.length > 1) {
        setAwaitingWriteFollowup(sessionId, true);
        const list = matches.map((m) => `${m.venue} on ${m.date} (₹${m.amount})`).join("; ");
        return { kind: "answer" as const, text: `I found more than one transaction for "${extracted.personName}": ${list}. Which one do you mean?` };
      }
      if (extracted.refundAmount == null) {
        setAwaitingWriteFollowup(sessionId, true);
        return { kind: "answer" as const, text: "How much should I refund?" };
      }
      const proposal = await issueRefundTool.execute!(
        { txnId: matches[0].txnId, amount: extracted.refundAmount, reason: extracted.refundReason ?? "Vendor-requested refund" },
        requestCtxAny
      ) as any;
      return finishProposal(vendorId, sessionId, "issueRefund", proposal, suspend);
    }

    // extendTrial / updateMembershipDate both target a membership
    const membershipMatches = api.findMembershipByUserName(vendorId, extracted.personName);
    if (membershipMatches.length === 0) {
      setAwaitingWriteFollowup(sessionId, true);
      return { kind: "answer" as const, text: `I couldn't find a member named "${extracted.personName}" — could you check the spelling?` };
    }
    if (membershipMatches.length > 1) {
      setAwaitingWriteFollowup(sessionId, true);
      const list = membershipMatches
        .map((m) => `${(api.getMembership(vendorId, m.membershipId)).userName} — ${m.activityId} (${m.status})`)
        .join("; ");
      return { kind: "answer" as const, text: `I found more than one match for "${extracted.personName}": ${list}. Which one do you mean?` };
    }
    const membershipId = membershipMatches[0].membershipId;

    if (toolName === "extendTrial") {
      if (extracted.extraDays == null) {
        setAwaitingWriteFollowup(sessionId, true);
        return { kind: "answer" as const, text: "How many days should I extend the trial by?" };
      }
      const proposal = await extendTrialTool.execute!({ membershipId, extraDays: extracted.extraDays }, requestCtxAny) as any;
      return finishProposal(vendorId, sessionId, "extendTrial", proposal, suspend);
    }

    // updateMembershipDate
    if (!extracted.newEndDate) {
      setAwaitingWriteFollowup(sessionId, true);
      return { kind: "answer" as const, text: "What new end date should I set (YYYY-MM-DD)?" };
    }
    const proposal = await updateMembershipDateTool.execute!({ membershipId, newEndDate: extracted.newEndDate }, requestCtxAny) as any;
    return finishProposal(vendorId, sessionId, "updateMembershipDate", proposal, suspend);
  },
});

export const copilotWorkflow = createWorkflow({
  id: "copilotWorkflow",
  inputSchema,
  outputSchema,
})
  .then(copilotStep)
  .commit();