/**
 * The two domain agents. A lightweight rule-based Router (src/workflow) decides
 * which one handles a given vendor message; see design report §6.
 *
 * Both agents run on Groq (fast open-weight model hosting) via the Vercel AI
 * SDK provider — swap AGENT_MODEL_ID in .env for any other @ai-sdk-compatible
 * model without touching this file.
 *
 * Default is openai/gpt-oss-120b: it's what's actually available and stable
 * on Groq's free/developer tier as of this writing (moonshotai/kimi-k2-
 * instruct-0905 — tried as an alternative for its stronger tool-use
 * benchmarks — was itself deprecated back in favour of gpt-oss-120b on
 * 2026-03-23, per https://console.groq.com/docs/deprecations, and now 404s).
 *
 * IMPORTANT DESIGN NOTE on actionAgent: it does NOT use tool-calling. In
 * testing, gpt-oss-120b was unreliable at actually invoking tools on the
 * write path — it would frequently skip straight to a plausible-sounding
 * text answer with self-computed values instead of calling findUser/a write
 * tool, even with retries, nudging, and toolChoice:"required" (which Groq's
 * API itself rejects with a hard error if the model still doesn't comply).
 * Structured JSON-schema output, by contrast, is a much more reliable
 * capability across models — it's closer to constrained decoding than to
 * agentic tool-choice. So actionAgent's only job is NLU: parse the vendor's
 * message into the actionExtractionSchema below. All entity resolution,
 * guardrail checks, and tool execution happen in deterministic code in
 * copilotWorkflow.ts, reusing the same write-tool `execute` functions
 * (still proposal-only) — just invoked directly instead of via LLM tool
 * choice. This keeps the propose-then-approve guarantee fully intact while
 * removing the failure mode entirely, rather than working around it.
 */
import { Agent } from "@mastra/core/agent";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import { readTools } from "../tools/tools.js";

const AGENT_MODEL = process.env.AGENT_MODEL_ID || "openai/gpt-oss-120b";

export const analyticsAgent = new Agent({
  id: "analytics-agent",
  name: "HobbyFi Analytics Agent",
  description: "Answers read-only questions about a vendor's revenue, trial users and bookings.",
  instructions: `You are the read-only analytics assistant inside the HobbyFi vendor portal Copilot.

Rules you must follow:
- Answer ONLY using data returned by your tools. Never state a number, date or count that didn't come from a tool result in this turn.
- If a tool hasn't given you the information needed to answer, say so plainly and ask a short clarifying question instead of guessing.
- Prefer concise, direct answers a busy vendor can read in two seconds: lead with the number/answer, then one line of context.
- You have no write tools and must never claim to have changed anything.
- Today's date, for relative date ranges like "today" or "this week", will be given to you in the user message.`,
  model: groq(AGENT_MODEL),
  tools: readTools,
});

/** What actionAgent extracts from a vendor's write request — pure NLU, no side effects. */
// Groq's structured-output mode uses OpenAI's "strict" JSON schema
// convention: every property must appear in the schema's `required` array,
// including ones that don't always have a value. z.optional() omits a key
// from `required` entirely, which Groq rejects outright (400). z.nullable()
// keeps the key required but lets the value be `null`, which is what strict
// mode expects — so every conditionally-present field below is nullable,
// not optional, and callers check for `== null` rather than `undefined`.
export const actionExtractionSchema = z.object({
  needsClarification: z
    .boolean()
    .describe("true if you cannot determine both the target person and the action from the message/history so far"),
  clarifyingQuestion: z
    .string()
    .nullable()
    .describe("required if needsClarification is true — a short, plain-language question for the vendor. Otherwise null."),
  action: z
    .enum(["extendTrial", "updateMembershipDate", "issueRefund"])
    .nullable()
    .describe("required if needsClarification is false. Otherwise null."),
  personName: z
    .string()
    .nullable()
    .describe("the name of the person the vendor mentioned, exactly as written — required for all three actions, otherwise null"),
  extraDays: z.number().nullable().describe("for extendTrial only: number of days to extend by, as stated by the vendor. Otherwise null."),
  newEndDate: z.string().nullable().describe("for updateMembershipDate only: new end date as YYYY-MM-DD, only if explicitly given or unambiguously computable from a stated date. Otherwise null."),
  refundAmount: z.number().nullable().describe("for issueRefund only: the amount in INR, as stated by the vendor. Otherwise null."),
  refundReason: z.string().nullable().describe("for issueRefund only: the reason given by the vendor. Otherwise null."),
});
export type ActionExtraction = z.infer<typeof actionExtractionSchema>;

export const actionAgent = new Agent({
  id: "action-agent",
  name: "HobbyFi Action Agent",
  description: "Extracts a structured write-action request from a vendor's message. Does not execute anything itself.",
  instructions: `You parse a vendor's message in the HobbyFi vendor portal Copilot into a structured action request. You do not execute anything and you have no tools — your only job is accurate extraction.

Rules:
- Extract only what the vendor actually stated. Never invent or compute values (e.g. don't turn "5 days" into a specific end date yourself — leave date computation to the system).
- personName should be exactly as the vendor wrote it (e.g. "Aisha", not "Aisha Khan" if they only said "Aisha").
- If you can't confidently determine both the person and the action, set needsClarification: true with a short question instead of guessing.
- Do not ask the vendor for internal IDs (membershipId, transactionId) — the system resolves those from personName.`,
  model: groq(AGENT_MODEL),
  // No tools: structured output only. See design note above.
});