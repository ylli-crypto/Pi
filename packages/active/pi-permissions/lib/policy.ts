import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

import { isPathBearingTool } from "./normalize.ts";
import type {
  AllowRule,
  Decision,
  Evaluation,
  Gate,
  PathCandidate,
  PermissionConfig,
  PermissionRequest,
  PresetName,
  SessionRuleStore,
} from "./types.ts";

const SAFE_FILE_TOOLS = new Set(["read", "grep", "find", "ls"]);
const SAFE_SHELL_COMMANDS = new Set([
  "pwd",
  "whoami",
  "id",
  "hostname",
  "date",
  "uptime",
  "ls",
  "tree",
  "stat",
  "file",
  "wc",
  "du",
  "df",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "fd",
  "diff",
  "cmp",
  "comm",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "cksum",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "uname",
  "which",
  "type",
]);
const UNSAFE_SEARCH_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-x",
  "-X",
  "--exec",
  "--exec-batch",
  "--pre",
]);

function isUnsafeSearchFlag(token: string): boolean {
  return UNSAFE_SEARCH_FLAGS.has(token) || token.startsWith("--pre=");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` is intentionally greedy across directories, like Claude-style rules. */
export function wildcardMatch(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedValue = value.replace(/\\/g, "/");
  const source = `^${normalizedPattern
    .split("*")
    .map(escapeRegExp)
    .join(".*")}$`;
  if (new RegExp(source, process.platform === "win32" ? "i" : "").test(normalizedValue)) {
    return true;
  }
  // A command-family rule such as `git status *` includes the bare command.
  return normalizedPattern.endsWith(" *") && wildcardMatch(normalizedPattern.slice(0, -2), normalizedValue);
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

function canonicalRoot(path: string): string {
  return existsSync(path) ? realpathSync.native(path) : resolve(path);
}

function isSensitive(candidate: PathCandidate, agentDir: string): string | undefined {
  const values = [candidate.original, candidate.resolved, candidate.canonical];
  const home = homedir();
  const fixedRoots: Array<[string, string]> = [
    [canonicalRoot(join(home, ".ssh")), "SSH keys and configuration"],
    [canonicalRoot(join(home, ".gnupg")), "GnuPG data"],
    [canonicalRoot(join(home, ".aws")), "AWS credentials and configuration"],
    [canonicalRoot(join(agentDir, "auth")), "Pi authentication storage"],
    [canonicalRoot(join(agentDir, "credentials")), "Pi credential storage"],
    [canonicalRoot(join(agentDir, "extensions", "pi-permissions", "config.json")), "the permission policy configuration"],
  ];

  for (const value of values) {
    const absolute = resolve(home, value.startsWith("~") ? `${home}${value.slice(1)}` : value);
    for (const [root, reason] of fixedRoots) {
      if (within(root, absolute)) return reason;
    }
    const name = basename(value);
    if ((name === ".env" || name.startsWith(".env.")) && name !== ".env.example") {
      return "environment secret files";
    }
  }
  return undefined;
}

function matchesRule(rule: AllowRule, request: PermissionRequest, path?: PathCandidate): boolean {
  switch (rule.surface) {
    case "tool":
      return request.kind === "tool" && rule.subject === request.toolName;
    case "tool-path":
      return (
        request.kind === "tool" &&
        rule.subject === request.toolName &&
        path !== undefined &&
        typeof rule.pattern === "string" &&
        wildcardMatch(rule.pattern, path.canonical)
      );
    case "bash":
      return request.kind === "bash" && wildcardMatch(rule.subject, request.subject);
    case "mcp":
      return request.kind === "mcp" && wildcardMatch(rule.subject, request.subject);
    case "skill":
      return request.kind === "skill" && wildcardMatch(rule.subject, request.subject);
    case "external":
      return path !== undefined && wildcardMatch(rule.subject, path.canonical);
  }
}

function ruleAllows(
  rules: AllowRule[],
  request: PermissionRequest,
  path?: PathCandidate,
): boolean {
  return rules.some((rule) => matchesRule(rule, request, path));
}

function gitReadOnlyFamily(tokens: string[]): string | undefined {
  if (tokens[0] !== "git") return undefined;
  const subcommand = tokens[1];
  if (!subcommand) return undefined;
  if (["status", "diff", "log", "show", "blame", "ls-files"].includes(subcommand)) {
    return `git ${subcommand} *`;
  }
  if (subcommand === "branch" && tokens.slice(2).every((token) => !["-d", "-D", "--delete", "-m", "-M", "--move"].includes(token))) {
    return "git branch *";
  }
  if (subcommand === "remote" && tokens.slice(2).every((token) => token === "-v" || token === "--verbose")) {
    return "git remote *";
  }
  return undefined;
}

function safeShellFamily(request: PermissionRequest): string | undefined {
  const shell = request.shell;
  if (!shell?.simple || shell.hasLikelySecret || shell.tokens.length === 0) return undefined;
  const [command, ...arguments_] = shell.tokens;
  if (!command) return undefined;
  if (arguments_.some(isUnsafeSearchFlag)) return undefined;
  const gitFamily = gitReadOnlyFamily(shell.tokens);
  if (gitFamily) return gitFamily;
  if (!SAFE_SHELL_COMMANDS.has(command)) return undefined;
  // `find`, `fd`, and ripgrep can execute programs through these flags.
  if (["find", "fd", "rg"].includes(command) && arguments_.some(isUnsafeSearchFlag)) {
    return undefined;
  }
  return `${command} *`;
}

function presetDecision(request: PermissionRequest, preset: PresetName): Decision {
  if (preset === "strict") {
    if (request.kind === "tool" && request.toolName === "ls") return "allow";
    if (request.kind === "bash" && request.subject === "pwd") return "allow";
    return "ask";
  }

  if (request.kind === "tool" && SAFE_FILE_TOOLS.has(request.toolName)) return "allow";
  if (request.kind === "bash" && safeShellFamily(request)) return "allow";

  // Convenient keeps the same mutation boundary; it additionally allows
  // harmless machine-identification calls that are useful in diagnostics.
  if (
    preset === "convenient" &&
    request.kind === "bash" &&
    ["printenv", "ps"].includes(request.shell?.tokens[0] ?? "") &&
    request.shell?.simple
  ) {
    return "allow";
  }
  return "ask";
}

function makeRule(
  surface: AllowRule["surface"],
  subject: string,
  pattern?: string,
): Omit<AllowRule, "id" | "createdAt" | "source"> {
  return { surface, subject, ...(pattern ? { pattern } : {}) };
}

function externalSuggestion(path: PathCandidate): Omit<AllowRule, "id" | "createdAt" | "source"> {
  const directory = dirname(path.canonical);
  return makeRule("external", `${directory}${sep}*`);
}

/**
 * Return the first top-level shell segment. This intentionally stops before
 * `&&`, `;`, `|`, or `&`, so an approval for a compound command is stored as
 * a rule for its leading command only — the same command-prefix model used by
 * Codex-style approval prompts.
 */
function firstShellSegment(command: string): string {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      return command.slice(0, index).trim();
    }
  }
  return command.trim();
}

function actionSuggestion(request: PermissionRequest): Omit<AllowRule, "id" | "createdAt" | "source"> | undefined {
  if (request.kind === "mcp") return makeRule("mcp", request.subject);
  if (request.kind === "skill") return makeRule("skill", request.subject);
  if (request.kind === "bash") {
    // A command-prefix rule is deliberately available even for compound or
    // mutating shell syntax. Compound commands persist only their first shell
    // segment, matching the Codex-style "commands starting with" behavior.
    // Commands that appear to contain a secret are never persisted.
    if (request.shell?.hasLikelySecret) return undefined;
    const prefix = request.shell?.simple
      ? (safeShellFamily(request) ?? request.subject)
      : firstShellSegment(request.subject);
    return makeRule("bash", prefix.includes("*") ? prefix : `${prefix} *`);
  }

  if (["write", "edit"].includes(request.toolName)) {
    const path = request.paths[0];
    if (!path) return undefined;
    return makeRule("tool-path", request.toolName, `${dirname(path.canonical)}${sep}*`);
  }
  if (isPathBearingTool(request.toolName) || request.kind === "tool") {
    return makeRule("tool", request.toolName);
  }
  return undefined;
}

function actionGate(
  request: PermissionRequest,
  config: PermissionConfig,
  session: SessionRuleStore,
): Gate {
  const sessionAllowed = ruleAllows(session.getRules(), request, request.paths[0]);
  // Secret-bearing commands can use a one-off/session grant but never inherit
  // a persisted rule. Complex commands are eligible for their first-segment
  // command-prefix rule suggested above.
  const persistentAllowed =
    request.kind === "bash" && request.shell?.hasLikelySecret
      ? false
      : ruleAllows(config.rules, request, request.paths[0]);
  const decision = sessionAllowed || persistentAllowed
    ? "allow"
    : presetDecision(request, config.preset);
  const suggestedRule = actionSuggestion(request);
  return {
    label: request.kind === "bash" ? "Command" : "Action",
    summary: request.summary,
    decision,
    suggestedRule,
    allowAlways: suggestedRule !== undefined,
    ...(request.kind === "bash" && !suggestedRule
      ? { reason: "Commands that may contain secrets cannot be saved globally." }
      : {}),
  };
}

/** Build gates in strict order. A later allow never overrides an earlier guard. */
export function evaluateRequest(
  request: PermissionRequest,
  config: PermissionConfig,
  session: SessionRuleStore,
  agentDir: string,
): Evaluation {
  for (const path of request.paths) {
    const reason = isSensitive(path, agentDir);
    if (reason) {
      return { gates: [], hardDeny: `Access to ${reason} is permanently blocked.` };
    }
  }

  // When permissions are disabled, skip every policy gate and prompt. Fixed
  // secret/credential protections above still apply; everything else is allowed.
  if (config.disabled) return { gates: [] };

  const gates: Gate[] = [];
  for (const path of request.paths.filter((candidate) => candidate.outsideWorkspace)) {
    const externalRequest: PermissionRequest = {
      ...request,
      kind: "tool",
      toolName: "external",
      subject: path.canonical,
    };
    const allowed =
      ruleAllows(session.getRules(), externalRequest, path) ||
      ruleAllows(config.rules, externalRequest, path);
    gates.push({
      label: "External directory",
      summary: `${request.summary}\nOutside workspace: ${path.canonical}`,
      decision: allowed ? "allow" : "ask",
      suggestedRule: externalSuggestion(path),
      allowAlways: true,
    });
  }
  gates.push(actionGate(request, config, session));
  return { gates };
}

export function fixedProtections(agentDir: string): string[] {
  return [
    ".env and .env.* (except .env.example)",
    `${join(homedir(), ".ssh")}${sep}*`,
    `${join(homedir(), ".gnupg")}${sep}*`,
    `${join(homedir(), ".aws")}${sep}*`,
    `${join(agentDir, "auth")}${sep}* and ${join(agentDir, "credentials")}${sep}*`,
    join(agentDir, "extensions", "pi-permissions", "config.json"),
  ];
}

export function presetDescription(preset: PresetName): string {
  switch (preset) {
    case "strict":
      return "Only ls and pwd are auto-allowed.";
    case "safe-developer":
      return "Workspace inspection tools and vetted read-only commands are auto-allowed.";
    case "convenient":
      return "Safe developer policy plus basic diagnostic commands.";
  }
}
