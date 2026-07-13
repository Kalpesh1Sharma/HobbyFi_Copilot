import "dotenv/config";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import { mastra } from "./mastra.js";
import { vendors } from "./data/mockDb.js";
import { readAuditLog } from "./audit/auditLog.js";

function banner() {
  console.log("\n=================================================");
  console.log("  HobbyFi Copilot — vendor portal AI assistant demo");
  console.log("=================================================\n");
  console.log("Try things like:");
  console.log('  "What is my revenue today?"');
  console.log('  "List trial users of badminton"');
  console.log('  "Increase Aisha\'s free trial by 5 days"');
  console.log('  "Refund the transaction for Arjun\'s booking, ₹200, wrong charge"');
  console.log('  "audit" to print the audit log · "exit" to quit\n');
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.warn(
      "⚠️  GROQ_API_KEY is not set. The agents (Groq) will fail to respond until you " +
        "copy .env.example to .env and add your key from https://console.groq.com/keys. " +
        "Tools, guardrails and the approval workflow itself don't need a key — only the LLM calls do.\n"
    );
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  banner();

  console.log("Vendors: " + vendors.map((v) => `${v.vendorId} = ${v.name} (${v.city})`).join("  |  "));
  const vendorInput = (await rl.question(`Vendor ID [${vendors[0].vendorId}]: `)).trim();
  const vendorId = vendorInput || vendors[0].vendorId;
  const sessionId = randomUUID();
  const workflow = mastra.getWorkflow("copilotWorkflow");

  while (true) {
    const message = (await rl.question("\nYou: ")).trim();
    if (!message) continue;
    if (message.toLowerCase() === "exit") break;

    if (message.toLowerCase() === "audit") {
      const entries = readAuditLog(vendorId);
      console.log(`\n--- Audit log for ${vendorId} (${entries.length} entries) ---`);
      for (const e of entries) {
        console.log(`[${e.createdAt}] ${e.intentType.toUpperCase()} ${e.toolName} — ${e.approvalStatus}`);
      }
      continue;
    }

    try {
      const run = await workflow.createRun();
      let result = await run.start({ inputData: { vendorId, sessionId, message } });

      if (result.status === "suspended") {
        const payload = (result as any).suspendPayload?.copilotStep;
        console.log("\n  ┌─ Approval needed ─────────────────────────────");
        console.log(`  │ ${payload.summary}`);
        if (payload.before) console.log(`  │ Before: ${JSON.stringify(payload.before)}`);
        if (payload.after) console.log(`  │ After:  ${JSON.stringify(payload.after)}`);
        console.log("  └────────────────────────────────────────────────");
        const approveRaw = (await rl.question("  Approve this action? (y/n): ")).trim().toLowerCase();
        const approved = approveRaw === "y" || approveRaw === "yes";
        result = await run.resume({ step: "copilotStep", resumeData: { approved } });
      }

      if (result.status === "success") {
        console.log(`\nCopilot: ${result.result.text}`);
      } else if (result.status === "failed") {
        console.log(`\nCopilot: Sorry, something went wrong (${result.error?.message ?? "unknown error"}).`);
      } else {
        console.log(`\nCopilot: (unexpected workflow status: ${result.status})`);
      }
    } catch (err) {
      console.error("\nError running workflow:", err);
    }
  }

  rl.close();
  console.log("\nGoodbye!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
