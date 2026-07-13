/**
 * Append-only audit log. Every proposal, approval/rejection and executed
 * write lands here with before/after state — independent of conversational
 * memory, so it survives regardless of session TTLs and is queryable for
 * compliance. Backed by a local JSONL file for the demo; in production this
 * is a `copilot_audit_log` table (see the design report, §7).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "..", "audit-log.jsonl");

export type AuditEntry = {
  actionId: string;
  vendorId: string;
  intentType: "read" | "write";
  toolName: string;
  params: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  approvalStatus: "n/a" | "proposed" | "approved" | "rejected" | "executed" | "failed";
  message?: string;
  createdAt: string;
};

export function appendAudit(entry: AuditEntry) {
  if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, "");
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

export function readAuditLog(vendorId?: string): AuditEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  const lines = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l) as AuditEntry);
  return vendorId ? entries.filter((e) => e.vendorId === vendorId) : entries;
}
