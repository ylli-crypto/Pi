---
name: pi-subagents
description: Delegate non-trivial reconnaissance and review work to the available scout and reviewer subagents while keeping the parent context compact.
---

# Pi subagents

Only `scout` and `reviewer` exist. The parent agent is the only writer and orchestrator.

## Automatic delegation

- Before broad repository exploration, debugging, or external research, launch a fresh async `scout` with a narrow question.
- After meaningful code changes, launch a fresh async, read-only `reviewer` before finalizing.
- Skip delegation for direct commands, trivial questions, and single safe file operations.
- Use `outputMode: "file-only"` for long reports. Read only the needed sections rather than inserting full reports into the parent context.

## Agent contracts

### scout

Use for evidence gathering and context handoff. Give it an explicit target and ask for exact file paths, line ranges, key findings, risks, and a concise next-step recommendation. Prefer `context: "fresh"` and `async: true`.

### reviewer

Use for diff, plan, architecture, and decision-drift review. Ask it to inspect real files and report only evidence-backed findings with paths and line references. It is read-only unless the user explicitly authorizes a narrowly scoped fix. Prefer `context: "fresh"` for independent review; use forked context only when inherited decisions are necessary.

## Examples

```ts
subagent({
  agent: "scout",
  task: "Map the auth flow. Return relevant files, line ranges, tests, and risks. Do not edit.",
  context: "fresh",
  async: true,
  output: "scout-auth.md",
  outputMode: "file-only",
});

subagent({
  agent: "reviewer",
  task: "Review the current diff for correctness and regressions. Do not edit.",
  context: "fresh",
  async: true,
  output: "review.md",
  outputMode: "file-only",
});
```

Use `subagent({ action: "status", view: "fleet" })`, `/subagents-fleet`, or `/subagents-doctor` to inspect runtime state. Do not create, enable, or invoke any other agent roles.
