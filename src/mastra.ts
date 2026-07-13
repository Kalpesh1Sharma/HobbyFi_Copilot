import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { analyticsAgent, actionAgent } from "./agents/agents.js";
import { copilotWorkflow } from "./workflow/copilotWorkflow.js";

export const mastra = new Mastra({
  agents: { analyticsAgent, actionAgent },
  workflows: { copilotWorkflow },
  // File-backed so a suspended run survives the approval round-trip. Swap for
  // a Postgres-backed Mastra storage adapter in production.
  storage: new LibSQLStore({ id: "hobbyfi-copilot", url: "file:./mastra.db" }),
});
