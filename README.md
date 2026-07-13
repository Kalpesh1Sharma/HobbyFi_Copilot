# HobbyFi Copilot — Working Demo

A runnable implementation of the design in [`docs/HobbyFi_Copilot_Design_Report.pdf`](./docs/HobbyFi_Copilot_Design_Report.pdf):
an AI assistant for the HobbyFi vendor/partner portal that answers analytics
questions and proposes write actions that only execute after explicit
vendor approval.

Built on **Mastra** (agents, tools, workflows) with **Groq** as the model
provider, since Anthropic API access requires a paid key. Swapping to
Claude later is a one-line change in `src/agents/agents.ts`.

## What's real vs. mocked here

| Real | Mocked |
|---|---|
| Mastra `Agent`, `createTool`, `createWorkflow`/`createStep` | The database (in-memory arrays standing in for HobbyFi's actual services) |
| The suspend/resume approval gate (persisted via LibSQL) | Vendor auth (you pick a vendor ID from a list at startup) |
| Guardrail validation (caps, date checks, refund limits) | — |
| Append-only audit log (written to `audit-log.jsonl`) | — |
| Working memory (entity resolution cache) | — |

The point of the mocking is that `src/services/vendorApi.ts` is the **only**
file that would change if you pointed this at HobbyFi's real backend — every
tool, agent, guardrail and the workflow itself are unaware that the data
isn't coming from a real service.

## Quick start

```bash
npm install
cp .env.example .env        # add your GROQ_API_KEY (https://console.groq.com/keys)
npm run dev
```

You'll be prompted for a vendor ID (defaults shown on screen), then you can
chat. Try:

- `What is my revenue today?` — read path, answered directly
- `List trial users of badminton` — read path
- `Increase Aisha's free trial by 5 days` — write path: proposes, shows a
  before/after diff, asks `Approve this action? (y/n)`, only mutates the
  mock data if you type `y`
- `Increase Aisha's free trial by 90 days` — same path, but the guardrail
  (30-day cap) blocks it before it's even proposed
- `audit` — prints the audit log for the current vendor
- `exit` — quits

No API key? The tools, guardrails, workflow and approval gate all run and
were verified without one (see `Testing without a Groq key` below) — only
the two agents' natural-language understanding needs a live model call.

## Project layout

```
src/
  data/mockDb.ts          Mock vendors/venues/activities/users/memberships/bookings/transactions
  services/vendorApi.ts   "Internal services API" — the only file that touches data
  guardrails/rules.ts     Business-rule caps (trial extension limit, refund limit, date checks)
  audit/auditLog.ts       Append-only JSONL audit log
  memory/workingMemory.ts Per-session entity cache (resolves "this user")
  tools/tools.ts          Mastra tools: read tools call the API directly;
                           write tools are `requireApproval: true` and only
                           ever return a proposed diff, never mutate
  agents/agents.ts        analyticsAgent (read-only) and actionAgent
                           (proposes exactly one write tool call)
  workflow/router.ts       Lightweight read-vs-write intent classifier
  workflow/copilotWorkflow.ts  The orchestration: route → agent → suspend
                           for approval → privileged execute on resume
  mastra.ts                Wires agents + workflow + LibSQL storage together
  cli.ts                   Interactive REPL
```

## How this maps to the design report

- **Architecture** — `cli.ts` → `copilotWorkflow.ts` → agents/tools →
  `vendorApi.ts` mirrors the layered diagram in §2: the LLM never sits next
  to the data, only next to typed tools.
- **Tools & Frameworks** — real `@mastra/core` `Agent`/`createTool`/
  `createWorkflow`, `@ai-sdk/groq` as the model provider, `@mastra/libsql`
  for durable workflow state (§3).
- **Memory** — `workingMemory.ts` implements the working-memory scope from
  §4 (entity cache, TTL); the audit log is deliberately separate memory
  that survives regardless of session TTL.
- **Guardrails** — `rules.ts` implements the business-rule caps from §5.2;
  `tools.ts`'s `requireApproval: true` + proposal-only `execute` implements
  the structural read/write separation from §5.1 and §5.3; `auditLog.ts`
  implements §5.5.
- **Workflow orchestration** — `copilotWorkflow.ts` is a genuine Mastra
  `Workflow` using `suspend()`/`resume()` as the approval gate described in
  §6 — the workflow engine itself won't proceed past a proposed write until
  the vendor's decision comes back in, which was verified end-to-end (see
  below) independent of any LLM call.

## Known simplifications (called out explicitly, not hidden)

- **Router is a keyword classifier**, not the Haiku-tier LLM router
  described in the report — same input/output contract, swappable without
  touching the workflow (`src/workflow/router.ts`).
- **Single-process, single-vendor session** — no real vendor auth/JWT;
  vendor ID is chosen at CLI startup instead of coming from a session token.
- **Refund's "second approver above ₹5,000" rule blocks rather than
  routes to a second approver** — there's only one approval role in this
  demo, so the guardrail declines outright instead of escalating.
- **`extendTrial`'s cumulative 60-day cap** (mentioned in the report as a
  cross-action limit) isn't implemented — only the 30-day per-action cap is,
  since cumulative tracking needs persistent per-membership state the mock
  data layer doesn't carry.

## Testing without a Groq key

The agents' `generate()` calls were smoke-tested by substituting a stub that
returns the same shape Groq would (a tool call + text), so the workflow,
suspend/resume, guardrails, mutation and audit logging were all verified
end-to-end without needing live model access. That test script isn't
included in the repo (it's throwaway), but you can reproduce it by
monkey-patching `actionAgent.generate` in a scratch file the same way before
calling `workflow.createRun()`.

## License

MIT — built as part of the HobbyFi Copilot hiring challenge.
