export type PresetName = "strict" | "safe-developer" | "convenient";

export type RuleSurface =
  | "tool"
  | "tool-path"
  | "bash"
  | "mcp"
  | "skill"
  | "external";

export type Decision = "allow" | "ask" | "deny";

export interface AllowRule {
  id: string;
  surface: RuleSurface;
  /** Tool name, MCP target, skill name, or a Bash glob. */
  subject: string;
  /** Required only by tool-path rules. */
  pattern?: string;
  createdAt: string;
  source: "user";
}

export interface PermissionConfig {
  version: 1;
  preset: PresetName;
  /** When true, all prompts and policy checks are skipped (fixed secret protections remain). */
  disabled: boolean;
  ui: {
    doublePressToConfirm: boolean;
  };
  audit: {
    enabled: boolean;
    maxEntryChars: number;
  };
  rules: AllowRule[];
}

export interface PathCandidate {
  original: string;
  resolved: string;
  canonical: string;
  outsideWorkspace: boolean;
}

export type RequestKind = "tool" | "bash" | "mcp" | "skill";

export interface PermissionRequest {
  id: string;
  kind: RequestKind;
  /** Pi tool name for tool calls; "bash", "mcp", or "skill" otherwise. */
  toolName: string;
  /** Match target for the request kind. */
  subject: string;
  summary: string;
  paths: PathCandidate[];
  /** Bash-only classification used for preset and persistent-rule safety. */
  shell?: ShellClassification;
}

export interface ShellClassification {
  raw: string;
  normalized: string;
  tokens: string[];
  simple: boolean;
  reason?: string;
  hasLikelySecret: boolean;
  family?: string;
}

export interface Gate {
  label: string;
  summary: string;
  decision: Decision;
  /** A user/session rule suggested for this individual gate. */
  suggestedRule?: Omit<AllowRule, "id" | "createdAt" | "source">;
  /** False only when this request could expose a secret and must never persist. */
  allowAlways: boolean;
  reason?: string;
}

export interface Evaluation {
  gates: Gate[];
  hardDeny?: string;
}

export interface SessionRuleStore {
  getRules(): AllowRule[];
  add(rule: AllowRule): void;
  clear(): void;
}

export interface AuditEvent {
  event:
    | "request"
    | "decision"
    | "rule_saved"
    | "rule_save_rejected"
    | "config_error"
    | "gate_error";
  requestId?: string;
  at: string;
  details: Record<string, unknown>;
}
