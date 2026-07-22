import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { redact } from "./audit.ts";
import type {
  PathCandidate,
  PermissionRequest,
  ShellClassification,
} from "./types.ts";

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const SHELL_WRAPPERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "eval",
  "sudo",
  "env",
  "xargs",
  "nohup",
  "timeout",
  "nice",
  "time",
]);
const INDIRECT_FIND_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-x",
  "-X",
  "--exec",
  "--exec-batch",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return `${homedir()}${value.slice(1)}`;
  if (value === "$HOME") return homedir();
  if (value.startsWith("$HOME/")) return `${homedir()}${value.slice(5)}`;
  return value;
}

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function canonicalizePath(path: string): string {
  // `realpath(path)` only follows symlinks when the final leaf exists. Resolve
  // the nearest existing ancestor, then append missing segments so a request
  // like `workspace/link-to-ssh/new-key` still resolves under ~/.ssh.
  const missing: string[] = [];
  let ancestor = path;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor)
    ? realpathSync.native(ancestor)
    : ancestor;
  return resolve(canonicalAncestor, ...missing);
}

export function normalizePath(value: string, cwd: string): PathCandidate {
  const original = stripAtPrefix(value.trim());
  // macOS commonly exposes /tmp as a symlink. Compare canonical forms so an
  // in-workspace request does not become an accidental external-path prompt.
  const canonicalCwd = canonicalizePath(resolve(cwd));
  const resolved = resolve(canonicalCwd, expandHome(original));
  const canonical = canonicalizePath(resolved);
  const fromWorkspace = relative(canonicalCwd, canonical);
  const outsideWorkspace =
    fromWorkspace === ".." || fromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromWorkspace);
  return { original, resolved, canonical, outsideWorkspace };
}

function tokenizeSimpleShell(command: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote || escaped) return undefined;
  if (current) tokens.push(current);
  return tokens;
}

function likelySecret(command: string): boolean {
  return /(?:authorization\s*[:=]|bearer\s+|(?:api[_-]?key|token|secret|password|passwd)\s*[=:]|--(?:api[_-]?key|token|password|secret)(?:=|\s))/i.test(
    command,
  );
}

export function classifyShell(command: string): ShellClassification {
  const normalized = command.trim().replace(/\s+/g, " ");
  const hasLikelySecret = likelySecret(command);
  if (!normalized) {
    return { raw: command, normalized, tokens: [], simple: false, reason: "empty command", hasLikelySecret };
  }
  if (/[;&|<>`\n]/.test(command) || /\$[({]/.test(command)) {
    return {
      raw: command,
      normalized,
      tokens: [],
      simple: false,
      reason: "compound, redirected, or substituted shell syntax",
      hasLikelySecret,
    };
  }
  const tokens = tokenizeSimpleShell(command);
  if (!tokens || tokens.length === 0) {
    return { raw: command, normalized, tokens: [], simple: false, reason: "unparseable shell syntax", hasLikelySecret };
  }
  const executable = tokens[0] ?? "";
  if (SHELL_WRAPPERS.has(executable) || tokens.some((token) => INDIRECT_FIND_FLAGS.has(token))) {
    return {
      raw: command,
      normalized,
      tokens,
      simple: false,
      reason: "shell or indirection wrapper",
      hasLikelySecret,
    };
  }
  return { raw: command, normalized, tokens, simple: true, hasLikelySecret };
}

function looksLikePath(token: string): boolean {
  return (
    token === "~" ||
    token.startsWith("~/") ||
    token.startsWith("$HOME/") ||
    token.startsWith("$") ||
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token === ".env" ||
    token.startsWith(".env.") ||
    token === "id_rsa" ||
    token.endsWith(".pem") ||
    token.includes("/")
  );
}

function uniquePaths(paths: PathCandidate[]): PathCandidate[] {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const key = `${candidate.original}\0${candidate.canonical}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shellPaths(shell: ShellClassification, cwd: string): PathCandidate[] {
  // For simple commands the tokenizer is authoritative. For compound commands,
  // still scan path-shaped lexical tokens so `.env` and credential guards cannot
  // be bypassed just by adding a redirect, pipe, or command substitution.
  const tokens = shell.simple
    ? [...shell.tokens]
    : (shell.raw.match(/(?:~\/|\$[A-Za-z_][A-Za-z0-9_]*\/|\/|\.\.\/|\.\/)[^\s;|&<>`]+|(?:^|\s)(?:\.env(?:\.[^\s;|&<>`]*)?|id_rsa)\b/g) ?? [])
        .map((token) => token.trim());
  // Catch sensitive names embedded in variable expansion or quoted program
  // arguments (for example `${PWD}/.env` or `python -c "open('.env')"`).
  const envMatch = shell.raw.match(/\.env(?:\.[A-Za-z0-9_.-]+)?/);
  if (envMatch?.[0]) tokens.push(envMatch[0]);
  if (/[\/$]\.ssh(?:[\/]|$)/.test(shell.raw)) tokens.push("~/.ssh");
  return uniquePaths(
    tokens
      .filter((token) => !token.startsWith("-") && looksLikePath(token))
      .map((token) => normalizePath(token, cwd)),
  );
}

function extractInputPaths(input: Record<string, unknown>, cwd: string): PathCandidate[] {
  const candidates: string[] = [];
  const directPath = asString(input.path);
  if (directPath) candidates.push(directPath);
  const argumentsValue = asRecord(input.arguments);
  const nestedPath = asString(argumentsValue.path);
  if (nestedPath) candidates.push(nestedPath);
  return uniquePaths(candidates.map((path) => normalizePath(path, cwd)));
}

function summarizeTool(toolName: string, input: Record<string, unknown>): string {
  const path = asString(input.path);
  if (path) {
    if (toolName === "write") {
      return `write ${redact(path)} (${asString(input.content)?.length ?? 0} characters)`;
    }
    if (toolName === "edit") {
      const edits = Array.isArray(input.edits) ? input.edits.length : 1;
      return `edit ${redact(path)} (${edits} replacement${edits === 1 ? "" : "s"})`;
    }
    return `${toolName} ${redact(path)}`;
  }
  const preview = redact(JSON.stringify(input));
  return `${toolName} ${preview}`;
}

export function normalizeToolCall(
  toolName: string,
  rawInput: unknown,
  cwd: string,
): PermissionRequest {
  const input = asRecord(rawInput);
  const id = randomUUID();

  if (toolName === "bash") {
    const command = asString(input.command) ?? "";
    const shell = classifyShell(command);
    return {
      id,
      kind: "bash",
      toolName,
      subject: shell.normalized,
      summary: `bash: ${redact(shell.normalized || command)}`,
      paths: shellPaths(shell, cwd),
      shell,
    };
  }

  if (toolName === "mcp") {
    const target =
      asString(input.tool) ??
      ([asString(input.server), asString(input.name)].filter(Boolean).join(":") || "mcp");
    return {
      id,
      kind: "mcp",
      toolName,
      subject: target,
      summary: `MCP ${redact(target)}${input.arguments ? ` ${redact(JSON.stringify(input.arguments))}` : ""}`,
      paths: extractInputPaths(input, cwd),
    };
  }

  return {
    id,
    kind: "tool",
    toolName,
    subject: toolName,
    summary: summarizeTool(toolName, input),
    paths: extractInputPaths(input, cwd),
  };
}

export function normalizeSkillInvocation(text: string, cwd: string): PermissionRequest | undefined {
  const match = text.trim().match(/^\/skill:([A-Za-z0-9_.-]+)(?:\s|$)/);
  if (!match?.[1]) return undefined;
  return {
    id: randomUUID(),
    kind: "skill",
    toolName: "skill",
    subject: match[1],
    summary: `skill: ${match[1]}`,
    paths: [],
  };
}

export function isPathBearingTool(toolName: string): boolean {
  return FILE_TOOLS.has(toolName);
}
