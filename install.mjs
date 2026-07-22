#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.argv.length !== 3 || process.argv[2] !== "--replace") {
  console.error("Usage: node install.mjs --replace");
  console.error("This replaces the global Pi package, agent, skill, and package configuration.");
  process.exit(2);
}

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const agentHome = join(homedir(), ".pi", "agent");
const setupHome = join(agentHome, "ylli-setup");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
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

run(npmCommand, [
  "install",
  "--global",
  "@earendil-works/pi-coding-agent@0.81.1",
  "--no-audit",
  "--no-fund",
]);

copyTree(join(sourceRoot, "packages", "active"), join(setupHome, "packages", "active"));
copyTree(join(sourceRoot, ".pi", "agents"), join(agentHome, "agents"));
copyTree(join(sourceRoot, ".pi", "skills"), join(agentHome, "skills"));
copyTree(join(sourceRoot, "config"), join(setupHome, "config"));

for (const entry of readdirSync(join(setupHome, "packages", "active"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packagePath = join(setupHome, "packages", "active", entry.name);
  if (existsSync(join(packagePath, "package-lock.json"))) {
    run(npmCommand, ["ci", "--omit=dev", "--no-audit", "--no-fund"], packagePath);
  }
}

const activePackagesPath = join(setupHome, "packages", "active");
const packages = readdirSync(activePackagesPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(activePackagesPath, entry.name, "package.json")))
  .map((entry) => join(activePackagesPath, entry.name))
  .sort((left, right) => left.localeCompare(right));

mkdirSync(agentHome, { recursive: true });
writeFileSync(
  join(agentHome, "settings.json"),
  JSON.stringify({ enableSkillCommands: true, packages }, null, 2) + "\n",
);

console.log("Pi setup installed in " + setupHome);
console.log("Start Pi from any directory with: pi");
