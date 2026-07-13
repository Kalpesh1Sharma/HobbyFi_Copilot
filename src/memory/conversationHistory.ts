/**
 * Short-term conversation memory, scoped per (session, agent) so read and
 * write flows don't cross-contaminate each other's tool-call history.
 *
 * Also tracks whether a session is "mid write-flow" — i.e. the action agent
 * asked a clarifying question (couldn't resolve the target entity or the
 * write parameters yet) and is waiting on the vendor's next message. This
 * is what lets the router keep routing short follow-up replies like "y" or
 * "mem_001" to the *same* agent + conversation, instead of the keyword
 * router misclassifying them as a fresh read query.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 10;
const history = new Map<string, ChatTurn[]>();
const pendingWriteFollowup = new Set<string>();

function historyKey(sessionId: string, agent: "read" | "write") {
  return `${sessionId}:${agent}`;
}

export function getHistory(sessionId: string, agent: "read" | "write"): ChatTurn[] {
  return history.get(historyKey(sessionId, agent)) ?? [];
}

export function pushTurns(sessionId: string, agent: "read" | "write", turns: ChatTurn[]) {
  const key = historyKey(sessionId, agent);
  const arr = history.get(key) ?? [];
  arr.push(...turns);
  while (arr.length > MAX_TURNS) arr.shift();
  history.set(key, arr);
}

export function isAwaitingWriteFollowup(sessionId: string): boolean {
  return pendingWriteFollowup.has(sessionId);
}

export function setAwaitingWriteFollowup(sessionId: string, waiting: boolean) {
  if (waiting) pendingWriteFollowup.add(sessionId);
  else pendingWriteFollowup.delete(sessionId);
}

export function clearSessionMemory(sessionId: string) {
  history.delete(historyKey(sessionId, "read"));
  history.delete(historyKey(sessionId, "write"));
  pendingWriteFollowup.delete(sessionId);
}
