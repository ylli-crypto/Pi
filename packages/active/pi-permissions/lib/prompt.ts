import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Gate } from "./types.ts";

export type UserDecision = "once" | "session" | "always" | "deny";

interface PromptTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

const DECISIONS: Array<{ key: string; value: UserDecision; label: string }> = [
  { key: "1", value: "once", label: "Allow once" },
  { key: "2", value: "session", label: "Allow for this session" },
  { key: "3", value: "always", label: "Always allow globally" },
  { key: "4", value: "deny", label: "Deny" },
];

class PermissionPromptComponent {
  private selected = 0;
  private armed?: UserDecision;

  constructor(
    private readonly theme: PromptTheme,
    private readonly gate: Gate,
    private readonly doublePress: boolean,
    private readonly requestRender: () => void,
    private readonly done: (decision: UserDecision) => void,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.theme.bold(`${this.gate.label} permission`)),
      ...this.gate.summary.split("\n"),
      "",
    ];
    for (const [index, option] of DECISIONS.entries()) {
      const unavailable = option.value === "always" && !this.gate.allowAlways;
      const marker = index === this.selected ? "▶" : " ";
      const suffix = unavailable ? " (not available for this request)" : "";
      const row = `${marker} (${option.key}) ${option.label}${suffix}`;
      lines.push(index === this.selected ? this.theme.fg("accent", row) : row);
    }
    if (this.gate.reason) lines.push("", this.theme.fg("warning", this.gate.reason));
    lines.push("");
    lines.push(
      this.theme.fg(
        "muted",
        this.armed
          ? `Press again to ${this.armed === "deny" ? "deny" : "confirm"}.`
          : "↑/↓ choose · enter confirm · 1-4 shortcut · esc deny",
      ),
    );
    return lines.flatMap((line) =>
      wrapTextWithAnsi(line, Math.max(width, 1)).map((wrapped) =>
        truncateToWidth(wrapped, Math.max(width, 1)),
      ),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up") || data === "k") {
      this.selected = (this.selected + DECISIONS.length - 1) % DECISIONS.length;
      this.armed = undefined;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.selected = (this.selected + 1) % DECISIONS.length;
      this.armed = undefined;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "escape")) {
      this.done("deny");
      return;
    }
    const shortcut = DECISIONS.find((option) => option.key === data);
    if (shortcut) {
      this.selected = DECISIONS.indexOf(shortcut);
      this.commit(shortcut.value);
      return;
    }
    if (matchesKey(data, "enter")) {
      this.commit(DECISIONS[this.selected]?.value ?? "deny");
    }
  }

  private commit(decision: UserDecision): void {
    if (decision === "always" && !this.gate.allowAlways) {
      this.armed = undefined;
      this.requestRender();
      return;
    }
    if (this.doublePress && this.armed !== decision) {
      this.armed = decision;
      this.requestRender();
      return;
    }
    this.done(decision);
  }
}

function optionLabel(gate: Gate, decision: UserDecision): string {
  if (decision === "always" && !gate.allowAlways) return "Always unavailable";
  return DECISIONS.find((option) => option.value === decision)?.label ?? "Deny";
}

/** Prompt only when a policy already resolved the request as `ask`. */
export async function requestDecision(
  ctx: ExtensionContext,
  gate: Gate,
  doublePress: boolean,
): Promise<UserDecision> {
  if (!ctx.hasUI) return "deny";

  if (ctx.mode !== "tui") {
    const choices = DECISIONS.filter(
      (option) => option.value !== "always" || gate.allowAlways,
    ).map((option) => option.label);
    const selected = await ctx.ui.select(
      `${gate.label} permission\n\n${gate.summary}${gate.reason ? `\n\n${gate.reason}` : ""}`,
      choices,
    );
    const decision = DECISIONS.find((option) => option.label === selected)?.value;
    return decision ?? "deny";
  }

  return ctx.ui.custom<UserDecision>(
    (tui, theme, _keybindings, done) =>
      new PermissionPromptComponent(
        theme,
        gate,
        doublePress,
        () => tui.requestRender(),
        done,
      ),
    { overlay: false },
  );
}

export function formatDecision(decision: UserDecision, gate: Gate): string {
  return optionLabel(gate, decision);
}
