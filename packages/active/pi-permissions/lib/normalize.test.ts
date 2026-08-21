import { normalizeToolCall, classifyShell, normalizePath } from "./normalize.ts";
import { evaluateRequest } from "./policy.ts";
import type { PermissionConfig, SessionRuleStore } from "./types.ts";

const cwd = "/Users/ylli/Desktop";

interface ExpectCase {
  command: string;
  /** expected canonical paths (subset check for relative-path cases) */
  expectCanonical: string[];
  /** tokens that must NOT appear bogusly as root-absolute paths */
  expectNoRootAbsolute: RegExp[];
  /** when true, at least one path must be flagged outside the workspace */
  expectOutsideWorkspace?: boolean;
}

const cases: ExpectCase[] = [
  {
    command: 'cd /Users/ylli/Desktop/frontend && sed -n "1,80p" src/ui/Dialog.tsx',
    expectCanonical: ["/Users/ylli/Desktop/frontend", "/Users/ylli/Desktop/src/ui/Dialog.tsx"],
    expectNoRootAbsolute: [/^\/ui\//],
  },
  {
    command: 'cd /Users/ylli/Desktop/frontend && grep -nE "Slice" src/api/types.ts',
    expectCanonical: ["/Users/ylli/Desktop/frontend", "/Users/ylli/Desktop/src/api/types.ts"],
    expectNoRootAbsolute: [/^\/api\//],
  },
  {
    command: "cd /Users/ylli/Desktop/frontend && sed 's/.*://' src/api/types.ts",
    expectCanonical: ["/Users/ylli/Desktop/frontend", "/Users/ylli/Desktop/src/api/types.ts"],
    expectNoRootAbsolute: [/^\/\.\*:/],
  },
  // A genuinely absolute outside-workspace path must STILL be detected
  // (macOS canonicalizes /etc -> /private/etc, so assert outsideWorkspace, not the literal).
  {
    command: "cat /etc/hosts",
    expectCanonical: [],
    expectNoRootAbsolute: [],
    expectOutsideWorkspace: true,
  },
  // ~ and $HOME must still expand to the user home (kept as a path).
  {
    command: "cat ~/Documents/notes",
    expectCanonical: ["/Users/ylli/Documents/notes"],
    expectNoRootAbsolute: [],
  },
  {
    command: "cat $HOME/Documents/notes",
    expectCanonical: ["/Users/ylli/Documents/notes"],
    expectNoRootAbsolute: [],
  },
  // Relative path containing a slash must stay relative (inside workspace).
  {
    command: "cat ./src/ui/Dialog.tsx",
    expectCanonical: ["/Users/ylli/Desktop/src/ui/Dialog.tsx"],
    expectNoRootAbsolute: [/^\/ui\//],
  },
];

let fail = 0;
function check(cond: boolean, label: string): void {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

for (const c of cases) {
  const req = normalizeToolCall("bash", { command: c.command }, cwd);
  const canons = req.paths.map((p) => p.canonical);
  console.log(`\nCMD: ${c.command}`);
  for (const ec of c.expectCanonical) {
    check(canons.includes(ec), `  expects canonical ${ec}`);
  }
  for (const re of c.expectNoRootAbsolute) {
    const bad = canons.filter((p) => re.test(p));
    check(bad.length === 0, `  no bogus root-absolute matching ${re} (found: ${bad.join(", ") || "none"})`);
  }
  if (c.expectOutsideWorkspace) {
    check(req.paths.some((p) => p.outsideWorkspace), "  flags outside-workspace path");
  }
}

console.log("\n--- Secret / sensitive detection (must still hard-deny) ---");

const config: PermissionConfig = {
  version: 1,
  preset: "safe-developer",
  disabled: false,
  ui: { doublePressToConfirm: true },
  audit: { enabled: false, maxEntryChars: 500 },
  rules: [],
};
const session: SessionRuleStore = { getRules: () => [], add: () => {}, clear: () => {} };
const agentDir = "/Users/ylli/.pi/agent";

const sensitiveCommands = [
  "cat ~/.ssh/id_rsa && echo ok",
  'python -c "open(\".env\")"',
  "cat $HOME/.ssh/config",
  "sudo cat ~/.aws/credentials",
  "cat ~/.gnupg/pubring.kbx",
  "find /Users/ylli -name '*.pem' && cat ~/.ssh/id_rsa",
  "cat .env.production",
];
for (const cmd of sensitiveCommands) {
  const req = normalizeToolCall("bash", { command: cmd }, cwd);
  const evaluation = evaluateRequest(req, config, session, agentDir);
  check(
    evaluation.hardDeny !== undefined,
    `  hard-deny for sensitive command: ${JSON.stringify(cmd)} (${evaluation.hardDeny ?? "NO DENY!"})`,
  );
}

// A safe compound command must NOT be hard-denied.
{
  const req = normalizeToolCall("bash", { command: "cd /Users/ylli/Desktop/frontend && grep x src/ui/a.tsx" }, cwd);
  const evaluation = evaluateRequest(req, config, session, agentDir);
  check(evaluation.hardDeny === undefined, "  no hard-deny for harmless command");
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILURES`}`);
process.exit(fail === 0 ? 0 : 1);