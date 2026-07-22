import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { AuditLog } from "./lib/audit.ts";
import { PermissionConfigStore } from "./lib/config.ts";
import { registerPermissionManager } from "./lib/manager.ts";
import { normalizeSkillInvocation, normalizeToolCall } from "./lib/normalize.ts";
import { evaluateRequest } from "./lib/policy.ts";
import { requestDecision, type UserDecision } from "./lib/prompt.ts";
import { SessionApprovals } from "./lib/session.ts";
import type { Gate, PermissionRequest } from "./lib/types.ts";

interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}

export default function piPermissionsExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const config = new PermissionConfigStore(agentDir);
  const audit = new AuditLog(config.auditLogPath);
  const session = new SessionApprovals();
  let reportedConfigError: string | undefined;

  async function writeAudit(
    event: "request" | "decision" | "rule_saved" | "rule_save_rejected" | "config_error" | "gate_error",
    details: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const current = await config.ensureLoaded();
    await audit.append(
      { event, at: new Date().toISOString(), ...(requestId ? { requestId } : {}), details },
      current.audit.maxEntryChars,
      current.audit.enabled,
    ).catch(() => undefined);
  }

  async function applyDecision(
    ctx: ExtensionContext,
    request: PermissionRequest,
    gate: Gate,
    decision: UserDecision,
  ): Promise<AuthorizationResult> {
    if (decision === "deny") {
      await writeAudit("decision", { outcome: "denied", gate: gate.label, summary: gate.summary }, request.id);
      return { allowed: false, reason: `Permission denied: ${gate.summary}` };
    }
    if (decision === "once") {
      await writeAudit("decision", { outcome: "approved_once", gate: gate.label, summary: gate.summary }, request.id);
      return { allowed: true };
    }
    if (!gate.suggestedRule) {
      await writeAudit("rule_save_rejected", { gate: gate.label, reason: gate.reason ?? "No safe rule can be generated" }, request.id);
      return { allowed: false, reason: "This request cannot be saved as a permission rule." };
    }
    if (decision === "session") {
      const saved = session.addSuggestion(gate.suggestedRule);
      await writeAudit("decision", { outcome: "approved_for_session", gate: gate.label, rule: saved }, request.id);
      return { allowed: true };
    }

    try {
      const saved = await config.addRule(gate.suggestedRule);
      await writeAudit("rule_saved", { gate: gate.label, rule: saved }, request.id);
      ctx.ui.notify(`Saved global allow rule: ${saved.surface} ${saved.subject}${saved.pattern ? ` → ${saved.pattern}` : ""}`, "info");
      return { allowed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeAudit("rule_save_rejected", { gate: gate.label, reason: message }, request.id);
      return { allowed: false, reason: `Approval was not saved, so the action was blocked: ${message}` };
    }
  }

  async function authorize(
    ctx: ExtensionContext,
    request: PermissionRequest,
  ): Promise<AuthorizationResult> {
    const current = await config.ensureLoaded();
    await writeAudit("request", {
      kind: request.kind,
      toolName: request.toolName,
      subject: request.subject,
      summary: request.summary,
      paths: request.paths.map((path) => path.canonical),
    }, request.id);

    const evaluation = evaluateRequest(request, current, session, agentDir);
    if (evaluation.hardDeny) {
      await writeAudit("decision", { outcome: "hard_deny", reason: evaluation.hardDeny }, request.id);
      return { allowed: false, reason: evaluation.hardDeny };
    }

    if (current.disabled) {
      await writeAudit("decision", { outcome: "disabled_bypass", kind: request.kind, summary: request.summary }, request.id);
      return { allowed: true };
    }

    for (const gate of evaluation.gates) {
      if (gate.decision === "deny") {
        await writeAudit("decision", { outcome: "policy_deny", gate: gate.label, reason: gate.reason }, request.id);
        return { allowed: false, reason: gate.reason ?? "Denied by permission policy." };
      }
      if (gate.decision === "allow") {
        await writeAudit("decision", { outcome: "policy_allow", gate: gate.label, summary: gate.summary }, request.id);
        continue;
      }
      const decision = await requestDecision(ctx, gate, current.ui.doublePressToConfirm);
      const applied = await applyDecision(ctx, request, gate, decision);
      if (!applied.allowed) return applied;
    }
    return { allowed: true };
  }

  registerPermissionManager(pi, config);

  pi.on("session_start", async (_event, ctx) => {
    session.clear();
    await config.load();
    if (config.loadError && config.loadError !== reportedConfigError) {
      reportedConfigError = config.loadError;
      await writeAudit("config_error", { error: config.loadError });
      ctx.ui.notify(
        `Pi permissions config is invalid; strict fail-closed policy is active: ${config.loadError}`,
        "warning",
      );
    }
    ctx.ui.setStatus("pi-permissions", config.current.disabled ? "permissions: disabled" : `permissions: ${config.current.preset}`);
  });

  pi.on("session_shutdown", () => {
    session.clear();
  });

  // This covers model-issued built-in and extension tool calls. Human-entered
  // `!` commands deliberately remain outside the gate.
  pi.on("tool_call", async (event, ctx) => {
    try {
      const request = normalizeToolCall(event.toolName, event.input, ctx.cwd);
      const result = await authorize(ctx, request);
      if (!result.allowed) return { block: true, reason: result.reason ?? "Permission denied." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeAudit("gate_error", { toolName: event.toolName, error: message });
      return { block: true, reason: `Permission gate failed closed: ${message}` };
    }
    return undefined;
  });

  // Skill expansion happens after the input event, so block unapproved skills
  // before their instructions can be added to model context.
  pi.on("input", async (event, ctx) => {
    const request = normalizeSkillInvocation(event.text, ctx.cwd);
    if (!request) return { action: "continue" as const };
    try {
      const result = await authorize(ctx, request);
      if (result.allowed) return { action: "continue" as const };
      ctx.ui.notify(result.reason ?? "Skill permission denied.", "warning");
      return { action: "handled" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeAudit("gate_error", { skill: request.subject, error: message }, request.id);
      ctx.ui.notify(`Skill permission gate failed closed: ${message}`, "error");
      return { action: "handled" as const };
    }
  });
}
