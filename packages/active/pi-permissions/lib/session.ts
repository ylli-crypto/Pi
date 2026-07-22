import type { AllowRule, SessionRuleStore } from "./types.ts";

/** In-memory only. Session rules are intentionally never written to disk. */
export class SessionApprovals implements SessionRuleStore {
  private rules: AllowRule[] = [];

  getRules(): AllowRule[] {
    return [...this.rules];
  }

  add(rule: AllowRule): void {
    this.rules.push(rule);
  }

  clear(): void {
    this.rules = [];
  }

  addSuggestion(rule: Omit<AllowRule, "id" | "createdAt" | "source">): AllowRule {
    const approval: AllowRule = {
      ...rule,
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      source: "user",
    };
    this.add(approval);
    return approval;
  }
}
