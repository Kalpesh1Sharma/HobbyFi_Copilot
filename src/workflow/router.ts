/**
 * Router: classifies a vendor message as a read (analytics) or write (action)
 * intent. In the design report (§3, §6) this is a Haiku-tier LLM call; here
 * it's a small deterministic keyword classifier so the whole demo runs
 * without needing a model call just to route, and so routing is instant and
 * free. Swap this for an LLM-router agent call in production without
 * touching the workflow around it — same input/output contract.
 *
 * One exception to pure keyword matching: if the session is mid write-flow
 * (the action agent asked a clarifying question last turn and is waiting on
 * an answer), every reply is forced to the write path regardless of its
 * own keywords — otherwise a short reply like "y" or "mem_001" would get
 * misrouted to the read agent and the write conversation would be lost.
 */
import { isAwaitingWriteFollowup } from "../memory/conversationHistory.js";

const WRITE_KEYWORDS = [
  "update", "increase", "extend", "change", "set ", "refund", "cancel",
  "add ", "remove", "decrease", "modify", "edit", "give ", "issue a refund",
  "issue refund", "apply", "move ", "reschedule", "waive", "credit",
];

const READ_KEYWORDS = [
  "what is", "what's", "list", "show", "how many", "how much", "revenue",
  "who is", "which", "when did", "did we", "is there",
];

export function classifyIntent(message: string, sessionId?: string): "read" | "write" {
  if (sessionId && isAwaitingWriteFollowup(sessionId)) return "write";

  const m = message.toLowerCase();
  const hasWrite = WRITE_KEYWORDS.some((k) => m.includes(k));
  const hasRead = READ_KEYWORDS.some((k) => m.includes(k));
  // A message can contain both ("show me and increase..."); write intent
  // wins because it's the higher-stakes path and should always go through
  // the approval-gated agent rather than being silently answered as a read.
  if (hasWrite) return "write";
  if (hasRead) return "read";
  // Default to read: the safer failure mode for an ambiguous message is
  // "answer a question" rather than "propose a mutation".
  return "read";
}
