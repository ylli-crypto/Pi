#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const piCommand = process.platform === "win32" ? "pi.cmd" : "pi";
const piPackage = "@earendil-works/pi-coding-agent@0.81.1";

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

if (isInside(piHome, sourceRoot)) {
  console.error("Clean installation cannot run from inside " + piHome + ".");
  console.error("Clone this repository into the directory where you want to keep it, then run the installer there.");
  process.exit(1);
}

await confirmReplacement();

console.log("[1/5] Removing the existing Pi installation...");
run(npmCommand, ["uninstall", "--global", "@earendil-works/pi-coding-agent", "--no-audit", "--no-fund"]);
rmSync(piHome, { recursive: true, force: true });

console.log("[2/5] Installing Pi globally...");
run(npmCommand, [
  "install",
  "--global",
  piPackage,
  "--no-audit",
  "--no-fund",
]);

console.log("[3/5] Configuring Pi from " + sourceRoot + "...");
copyTree(join(sourceRoot, ".pi", "agents"), join(agentHome, "agents"));
copyTree(join(sourceRoot, ".pi", "skills"), join(agentHome, "skills"));

const activePackagesPath = join(sourceRoot, "packages", "active");
const packageDirectories = readdirSync(activePackagesPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

console.log("[4/5] Installing dependencies for " + packageDirectories.length + " packages...");
for (const name of packageDirectories) {
  const packagePath = join(activePackagesPath, name);
  if (!existsSync(join(packagePath, "package-lock.json"))) continue;
  console.log("  - " + name);
  run(npmCommand, ["ci", "--omit=dev", "--no-audit", "--no-fund"], packagePath);
}

const packages = packageDirectories
  .filter((name) => existsSync(join(activePackagesPath, name, "package.json")))
  .map((name) => join(activePackagesPath, name));

mkdirSync(agentHome, { recursive: true });
writeFileSync(
  join(agentHome, "settings.json"),
  JSON.stringify({ enableSkillCommands: true, quietStartup: true, packages }, null, 2) + "\n",
);

console.log("[5/5] Checking the global pi command...");
const piCheck = spawnSync(piCommand, ["--version"], { stdio: "ignore" });
if (piCheck.error || piCheck.status !== 0) {
  console.error("Pi was installed globally, but its npm global bin directory is not on PATH.");
  console.error("Add npm's global bin directory to your system PATH, open a new terminal, then run: pi");
  process.exit(1);
}

console.log("Pi was installed globally and is available on PATH.");
console.log("Your 13 package sources stay in: " + sourceRoot);
console.log("Start Pi from any directory with: pi");
