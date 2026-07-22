import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  SettingsList,
  Text,
} from "@earendil-works/pi-tui";
import { sep } from "node:path";

import { PermissionConfigStore } from "./config.ts";
import { normalizePath } from "./normalize.ts";
import { fixedProtections, presetDescription } from "./policy.ts";
import type { AllowRule, PresetName, RuleSurface } from "./types.ts";

interface MenuItem {
  value: string;
  label: string;
  description?: string;
}

async function selectMenu(
  ctx: ExtensionCommandContext,
  title: string,
  items: MenuItem[],
  intro?: string,
): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    return ctx.ui.select(
      `${title}${intro ? `\n\n${intro}` : ""}`,
      items.map((item) => item.label),
    ).then((selected) => items.find((item) => item.label === selected)?.value);
  }
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 1));
    if (intro) container.addChild(new Text(theme.fg("muted", intro), 1, 0));
    const list = new SelectList(
      items as SelectItem[],
      Math.min(Math.max(items.length, 1), 12),
      {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      },
    );
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc back"), 1, 1));
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

function ruleLabel(rule: AllowRule): string {
  const subject = rule.pattern ? `${rule.subject} → ${rule.pattern}` : rule.subject;
  return `${rule.surface}: ${subject}`;
}

async function openSettings(ctx: ExtensionCommandContext, store: PermissionConfigStore): Promise<void> {
  if (ctx.mode !== "tui") {
    const choice = await selectMenu(ctx, "Permission settings", [
      { value: "preset", label: "Change preset", description: presetDescription(store.current.preset) },
      { value: "disable", label: store.current.disabled ? "Enable permissions" : "Disable permissions", description: store.current.disabled ? "Prompts are currently skipped" : "Skip all prompts and policy checks" },
      { value: "back", label: "Back" },
    ]);
    if (choice === "preset") {
      const preset = await selectMenu(ctx, "Permission preset", [
        { value: "strict", label: "Strict", description: presetDescription("strict") },
        { value: "safe-developer", label: "Safe developer", description: presetDescription("safe-developer") },
        { value: "convenient", label: "Convenient", description: presetDescription("convenient") },
      ]);
      if (preset) await store.setPreset(preset as PresetName);
    } else if (choice === "disable") {
      await store.update((next) => ({ ...next, disabled: !next.disabled }));
    }
    return;
  }

  await ctx.ui.custom<void>((_tui, _theme, _keybindings, done) => {
    const config = store.current;
    const settings = new SettingsList(
      [
        {
          id: "preset",
          label: "Preset",
          description: "Base policy; saved rules are retained when this changes",
          currentValue: config.preset,
          values: ["strict", "safe-developer", "convenient"],
        },
        {
          id: "doublePressToConfirm",
          label: "Double-press to confirm",
          description: "Require a second key press before an approval or denial commits",
          currentValue: config.ui.doublePressToConfirm ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "disabled",
          label: "Disable permissions",
          description: "Skip all prompts and policy checks. Fixed secret protections remain.",
          currentValue: config.disabled ? "on" : "off",
          values: ["on", "off"],
        },
      ],
      8,
      getSettingsListTheme(),
      (id, value) => {
        if (id === "preset") {
          void store.setPreset(value as PresetName);
        } else if (id === "doublePressToConfirm") {
          void store.update((next) => ({
            ...next,
            ui: { ...next.ui, doublePressToConfirm: value === "on" },
          }));
        } else if (id === "disabled") {
          void store.update((next) => ({ ...next, disabled: value === "on" }));
        }
      },
      () => done(),
    );
    return {
      render: (width: number) => settings.render(width),
      invalidate: () => settings.invalidate(),
      handleInput: (data: string) => settings.handleInput?.(data),
    };
  });
}

async function manageRules(ctx: ExtensionCommandContext, store: PermissionConfigStore): Promise<void> {
  while (true) {
    const rules = store.current.rules;
    const selection = await selectMenu(
      ctx,
      "Saved global allow rules",
      [
        ...rules.map((rule) => ({
          value: rule.id,
          label: ruleLabel(rule),
          description: `Created ${rule.createdAt}`,
        })),
        { value: "back", label: "Back" },
      ],
      rules.length ? "Select a rule to remove it." : "No user-created global rules.",
    );
    if (!selection || selection === "back") return;
    const rule = rules.find((item) => item.id === selection);
    if (!rule) continue;
    const choice = await ctx.ui.select(`Remove saved rule?\n\n${ruleLabel(rule)}`, [
      "Remove rule",
      "Keep rule",
    ]);
    if (choice === "Remove rule") {
      await store.removeRule(rule.id);
      ctx.ui.notify(`Removed ${ruleLabel(rule)}.`, "info");
    }
  }
}

function validSubject(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function addRule(ctx: ExtensionCommandContext, store: PermissionConfigStore): Promise<void> {
  const surface = await selectMenu(ctx, "Add global allow rule", [
    { value: "tool", label: "Tool", description: "Allow one exact Pi tool name" },
    { value: "tool-path", label: "Tool path", description: "Allow write/edit only under one directory" },
    { value: "bash", label: "Bash", description: "Allow a command or command-family glob" },
    { value: "mcp", label: "MCP", description: "Allow one exact server:tool target" },
    { value: "skill", label: "Skill", description: "Allow one exact skill name" },
    { value: "external", label: "External directory", description: "Allow access under one outside-workspace directory" },
  ]);
  if (!surface) return;

  let rule: Omit<AllowRule, "id" | "createdAt" | "source"> | undefined;
  if (surface === "tool" || surface === "mcp" || surface === "skill" || surface === "bash") {
    const subject = await ctx.ui.input(
      `${surface === "bash" ? "Command pattern" : "Exact target"}:`,
      surface === "bash" ? "git status *" : "",
    );
    if (validSubject(subject)) rule = { surface: surface as RuleSurface, subject: subject.trim() };
  } else if (surface === "tool-path") {
    const toolName = await ctx.ui.input("Tool name:", "write");
    const directory = await ctx.ui.input("Directory to allow:", ctx.cwd);
    if (validSubject(toolName) && validSubject(directory)) {
      rule = {
        surface: "tool-path",
        subject: toolName.trim(),
        pattern: `${normalizePath(directory.trim(), ctx.cwd).canonical}${sep}*`,
      };
    }
  } else if (surface === "external") {
    const directory = await ctx.ui.input("External directory to allow:", "");
    if (validSubject(directory)) {
      rule = {
        surface: "external",
        subject: `${normalizePath(directory.trim(), ctx.cwd).canonical}${sep}*`,
      };
    }
  }
  if (!rule) return;

  const confirmed = await ctx.ui.confirm(
    "Save global allow rule?",
    rule.pattern ? `${rule.surface}: ${rule.subject} → ${rule.pattern}` : `${rule.surface}: ${rule.subject}`,
  );
  if (!confirmed) return;
  await store.addRule(rule);
  ctx.ui.notify("Saved global allow rule.", "info");
}

async function auditAndReset(ctx: ExtensionCommandContext, store: PermissionConfigStore): Promise<void> {
  const choice = await selectMenu(ctx, "Audit and reset", [
    { value: "path", label: "Show config and audit paths" },
    { value: "reset", label: "Remove all user-created allow rules" },
    { value: "back", label: "Back" },
  ], `Audit: ${store.auditLogPath}`);
  if (choice === "path") {
    ctx.ui.notify(`Config: ${store.path}\nAudit: ${store.auditLogPath}`, "info");
  }
  if (choice === "reset") {
    const confirmed = await ctx.ui.confirm(
      "Remove every saved global allow rule?",
      "Fixed secret protections and the selected preset remain unchanged.",
    );
    if (confirmed) {
      await store.clearRules();
      ctx.ui.notify("Removed all user-created allow rules.", "info");
    }
  }
}

async function openManager(ctx: ExtensionCommandContext, store: PermissionConfigStore): Promise<void> {
  while (true) {
    const choice = await selectMenu(
      ctx,
      "Pi permissions",
      [
        { value: "settings", label: "Preset and confirmation settings", description: store.current.disabled ? "Permissions disabled — prompts skipped" : presetDescription(store.current.preset) },
        { value: "disable", label: store.current.disabled ? "Enable permissions" : "Disable permissions", description: store.current.disabled ? "Prompts are currently skipped" : "Skip all prompts and policy checks" },
        { value: "rules", label: "Saved global allow rules", description: `${store.current.rules.length} saved rule(s)` },
        { value: "add", label: "Add a global allow rule", description: "Guided rule wizard" },
        { value: "audit", label: "Audit and reset", description: "View locations or remove saved rules" },
        { value: "close", label: "Close" },
      ],
      `Fixed, non-editable protections:\n${fixedProtections(store.agentDir).map((item) => `• ${item}`).join("\n")}${store.current.disabled ? "\n\n⚠ Permissions are currently DISABLED." : ""}`,
    );
    if (!choice || choice === "close") return;
    if (choice === "settings") await openSettings(ctx, store);
    if (choice === "disable") {
      const turningOff = !store.current.disabled;
      if (turningOff) {
        const ok = await ctx.ui.confirm(
          "Disable permissions?",
          "All permission prompts and policy checks will be skipped. Fixed protections for secrets and credentials remain.",
        );
        if (!ok) continue;
      }
      await store.update((config) => ({ ...config, disabled: turningOff }));
      ctx.ui.notify(turningOff ? "Permissions disabled. Prompts will be skipped." : "Permissions re-enabled.", turningOff ? "warning" : "info");
    }
    if (choice === "rules") await manageRules(ctx, store);
    if (choice === "add") await addRule(ctx, store);
    if (choice === "audit") await auditAndReset(ctx, store);
  }
}

function printInfo(store: PermissionConfigStore, mode: "list" | "path" | "export"): void {
  if (mode === "path") {
    console.log(JSON.stringify({ config: store.path, audit: store.auditLogPath }, null, 2));
    return;
  }
  if (mode === "list") {
    console.log(JSON.stringify(store.current.rules, null, 2));
    return;
  }
  console.log(JSON.stringify(store.current, null, 2));
}

export function registerPermissionManager(pi: ExtensionAPI, store: PermissionConfigStore): void {
  pi.registerCommand("permissions", {
    description: "Manage Pi permission presets, the disable toggle, and saved global allow rules",
    getArgumentCompletions(prefix) {
      const values = ["list", "path", "export", "disable", "enable"];
      const matches = values.filter((value) => value.startsWith(prefix.trim()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      await store.ensureLoaded();
      const action = args.trim().toLowerCase();
      if (action === "list" || action === "path" || action === "export") {
        printInfo(store, action);
        return;
      }
      if (action === "disable") {
        await store.update((config) => ({ ...config, disabled: true }));
        ctx.ui.notify("Permissions disabled. Prompts will be skipped.", "warning");
        return;
      }
      if (action === "enable") {
        await store.update((config) => ({ ...config, disabled: false }));
        ctx.ui.notify("Permissions re-enabled.", "info");
        return;
      }
      if (action) {
        ctx.ui.notify("Usage: /permissions [list|path|export|disable|enable]", "warning");
        return;
      }
      if (!ctx.hasUI) {
        console.log(JSON.stringify({ config: store.path, audit: store.auditLogPath, rules: store.current.rules }, null, 2));
        return;
      }
      await openManager(ctx, store);
    },
  });
}
