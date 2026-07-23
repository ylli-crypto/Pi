#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

if (process.argv.length !== 2) {
  console.error("Usage: node install.mjs");
  process.exit(2);
}

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const piHome = join(homedir(), ".pi");
const agentHome = join(piHome, "agent");
const sourceLink = join(agentHome, "source-root");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const piPackage = "@earendil-works/pi-coding-agent@0.81.1";
const isWindows = process.platform === "win32";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path));
}

function copyTree(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = path.split(/[\\/]/).pop();
      return name !== "node_modules" && name !== ".DS_Store";
    },
  });
}

// Resolve the global pi binary path directly from npm's prefix instead of
// trusting the current process PATH (which may not include npm's global bin
// directory, e.g. nvm or isolated node installs). Returns an object with
// the resolved binary path, the bin directory, and a boolean indicating
// whether the binary was actually found and runnable.
function resolvePiBin() {
  let prefix = "";
  try {
    const prefixResult = spawnSync(npmCommand, ["config", "get", "prefix"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    if (prefixResult.status === 0 && prefixResult.stdout) {
      prefix = prefixResult.stdout.trim();
    }
  } catch {
    // ignore, fall back to PATH check below
  }

  if (prefix) {
    const binDir = isWindows ? prefix : join(prefix, "bin");
    const piBin = isWindows ? join(prefix, "pi.cmd") : join(binDir, "pi");
    if (existsSync(piBin)) {
      const versionCheck = spawnSync(piBin, ["--version"], { stdio: "ignore" });
      const runnable = !versionCheck.error && versionCheck.status === 0;
      return { piBin, binDir, found: true, runnable };
    }
  }

  // Fallback: check whether `pi` is callable on PATH.
  const piCommand = isWindows ? "pi.cmd" : "pi";
  const pathCheck = spawnSync(piCommand, ["--version"], { stdio: "ignore" });
  if (!pathCheck.error && pathCheck.status === 0) {
    return { piBin: piCommand, binDir: null, found: true, runnable: true, viaPath: true };
  }

  return { piBin: prefix ? (isWindows ? join(prefix, "pi.cmd") : join(prefix, "bin", "pi")) : null, binDir: prefix ? (isWindows ? prefix : join(prefix, "bin")) : null, found: false, runnable: false };
}

async function confirmReplacement() {
  console.log("");
  console.log("WARNING: YOUR CURRENT PI INSTALLATION WILL BE DELETED.");
  console.log("This removes the global Pi command and everything in " + piHome + ":");
  console.log("- settings and authentication");
  console.log("- sessions, extensions, agents, skills, and old Pi setup files");
  console.log("");
  console.log("The folder you are installing from will stay: " + sourceRoot);

  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question("Continue with clean installation? [yes/No] ");
  prompt.close();

  if (!["yes", "y", "ja", "j"].includes(answer.trim().toLowerCase())) {
    console.log("Installation cancelled. Nothing was changed.");
    process.exit(0);
  }
}

// --- Guards --------------------------------------------------------------

// 1. Structure guard: this must look like a Pi setup repo.
const requiredPaths = [
  join(sourceRoot, "packages", "active"),
  join(sourceRoot, ".pi", "agents"),
  join(sourceRoot, ".pi", "skills"),
];
const missingStructure = requiredPaths.filter((p) => !existsSync(p));
if (missingStructure.length > 0) {
  console.error("This does not look like a Pi setup repository.");
  console.error("Missing: " + missingStructure.join(", "));
  console.error("Clone https://github.com/ylli-crypto/Pi.git, then run the installer from the cloned folder.");
  process.exit(1);
}

// 2. Install-from-inside-~/.pi guard.
if (isInside(piHome, sourceRoot)) {
  console.error("Clean installation cannot run from inside " + piHome + ".");
  console.error("Clone this repository into the directory where you want to keep it, then run the installer there.");
  process.exit(1);
}

// 3. Confirmation prompt.
await confirmReplacement();

// --- Non-destructive install/upgrade first --------------------------------

console.log("[1/5] Installing Pi globally...");
run(npmCommand, ["install", "--global", piPackage, "--no-audit", "--no-fund"]);

console.log("[2/5] Verifying the global pi command...");
const piBinInfo = resolvePiBin();
if (!piBinInfo.found || !piBinInfo.runnable) {
  console.error("Pi was installed globally, but the pi command could not be verified.");
  if (piBinInfo.binDir) {
    console.error("Looked for: " + piBinInfo.piBin);
  } else {
    console.error("Could not determine npm's global bin directory.");
  }
  console.error("Your existing Pi data in " + piHome + " was NOT deleted.");
  console.error("Check that npm's global bin directory exists, then re-run this installer.");
  process.exit(1);
}

// --- Only now that Pi is installed & verified, perform the clean wipe ------

console.log("[3/5] Removing the existing Pi configuration...");
rmSync(piHome, { recursive: true, force: true });
mkdirSync(agentHome, { recursive: true });

console.log("[4/5] Configuring Pi from " + sourceRoot + "...");
copyTree(join(sourceRoot, ".pi", "agents"), join(agentHome, "agents"));
copyTree(join(sourceRoot, ".pi", "skills"), join(agentHome, "skills"));

// Symlink anchor: ~/.pi/agent/source-root -> sourceRoot.
// Relative package paths in settings.json resolve through this symlink, so
// moving the clone folder only requires re-running the installer (which
// re-points the symlink) without rewriting settings.json.
let useSymlink = true;
try {
  rmSync(sourceLink, { recursive: true, force: true });
  symlinkSync(sourceRoot, sourceLink, isWindows ? "junction" : "dir");
} catch (error) {
  useSymlink = false;
  console.warn("Warning: could not create source-root symlink (" + error.message + ").");
  if (isWindows) {
    console.warn("Package paths will be absolute. Re-run the installer from a new location, or enable Developer Mode / run as Administrator for symlink support.");
  }
}

const activePackagesPath = join(sourceRoot, "packages", "active");
const packageDirectories = readdirSync(activePackagesPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

// Relative paths anchored at the symlink when available; absolute paths
// as a fallback (Windows without symlink permission).
const packages = packageDirectories
  .filter((name) => existsSync(join(activePackagesPath, name, "package.json")))
  .map((name) => (useSymlink ? join("source-root", "packages", "active", name) : join(activePackagesPath, name)));

mkdirSync(agentHome, { recursive: true });
writeFileSync(
  join(agentHome, "settings.json"),
  JSON.stringify({ enableSkillCommands: true, quietStartup: true, packages }, null, 2) + "\n",
);

console.log("[5/5] Installing dependencies for " + packageDirectories.length + " packages...");
const failedPackages = [];
for (const name of packageDirectories) {
  const packagePath = join(activePackagesPath, name);
  if (!existsSync(join(packagePath, "package-lock.json"))) continue;
  console.log("  - " + name);
  const result = spawnSync(npmCommand, ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: packagePath,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    failedPackages.push(name);
    console.warn("  ! " + name + " dependency install failed. Pi will still start; re-run the installer to retry.");
  }
}

// --- Final report ---------------------------------------------------------

// Detect whether `pi` is reachable on the current PATH (separate from the
// direct binary verification above, which already succeeded).
const piCommand = isWindows ? "pi.cmd" : "pi";
const pathCheck = spawnSync(piCommand, ["--version"], { stdio: "ignore" });
const piOnPath = !pathCheck.error && pathCheck.status === 0;

console.log("");
if (piOnPath) {
  console.log("Pi was installed globally and is available on PATH.");
} else {
  console.log("Pi was installed globally.");
  if (piBinInfo.piBin) {
    console.log("pi command: " + piBinInfo.piBin);
  }
  if (piBinInfo.binDir) {
    console.log("To run `pi` from any terminal, add npm's global bin directory to your PATH: " + piBinInfo.binDir);
  }
}
console.log("Your " + packageDirectories.length + " package sources stay in: " + sourceRoot);
if (useSymlink) {
  console.log("Linked via: " + sourceLink);
} else {
  console.log("Package paths are absolute (symlink unavailable). Do not move the install folder.");
}
if (failedPackages.length > 0) {
  console.log("");
  console.log("Dependency install failed for " + failedPackages.length + " package(s): " + failedPackages.join(", "));
  console.log("Re-run this installer to retry. Pi will start, but those packages may not load until fixed.");
}
console.log("Start Pi from any directory with: pi");
