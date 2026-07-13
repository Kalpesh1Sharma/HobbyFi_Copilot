/**
 * Working memory: per-session, short-lived entity cache (see design report §4).
 *
 * Resolves anaphora like "this user" / "that trial" by remembering the last
 * entity a tool call surfaced. In production this lives in Redis with a TTL;
 * here it's an in-memory Map, which is enough to demonstrate the pattern in
 * a single CLI process and is trivially swappable for a Redis client later.
 */

type EntityRef = {
  type: "membership" | "user" | "booking" | "transaction";
  id: string;
  label: string; // human-readable, e.g. "Rohit Kumar's Badminton trial"
};

type SessionMemory = {
  lastEntity?: EntityRef;
  updatedAt: number;
};

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map<string, SessionMemory>();

export function setLastEntity(sessionId: string, entity: EntityRef) {
  store.set(sessionId, { lastEntity: entity, updatedAt: Date.now() });
}

export function getLastEntity(sessionId: string): EntityRef | undefined {
  const mem = store.get(sessionId);
  if (!mem) return undefined;
  if (Date.now() - mem.updatedAt > TTL_MS) {
    store.delete(sessionId);
    return undefined;
  }
  return mem.lastEntity;
}

export function clearSession(sessionId: string) {
  store.delete(sessionId);
}
