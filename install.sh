#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] || [ "$1" != "--replace" ]; then
  echo "Usage: ./install.sh --replace" >&2
  echo "This replaces the global Pi package, agent, skill, and package configuration." >&2
  exit 2
fi

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="$(node -e 'process.stdout.write(require("node:os").homedir())')"
AGENT_HOME="$USER_HOME/.pi/agent"
SETUP_HOME="$AGENT_HOME/ylli-setup"

command -v node >/dev/null || { echo "Node.js 20+ is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required." >&2; exit 1; }

npm install --global @earendil-works/pi-coding-agent@0.81.1 --no-audit --no-fund

mkdir -p "$SETUP_HOME" "$AGENT_HOME/agents" "$AGENT_HOME/skills"
rsync -a --delete --exclude node_modules "$SOURCE_ROOT/packages/active/" "$SETUP_HOME/packages/active/"
rsync -a --delete "$SOURCE_ROOT/.pi/agents/" "$AGENT_HOME/agents/"
rsync -a --delete "$SOURCE_ROOT/.pi/skills/" "$AGENT_HOME/skills/"
rsync -a --delete "$SOURCE_ROOT/config/" "$SETUP_HOME/config/"

while IFS= read -r -d '' package_dir; do
  (cd "$package_dir" && npm ci --omit=dev --no-audit --no-fund)
done < <(find "$SETUP_HOME/packages/active" -mindepth 1 -maxdepth 1 -type d -print0)

node - "$AGENT_HOME/settings.json" "$SETUP_HOME" "$SOURCE_ROOT/.pi/settings.json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [settingsPath, setupHome, sourceSettingsPath] = process.argv.slice(2);
const sourceSettings = JSON.parse(fs.readFileSync(sourceSettingsPath, "utf8"));
const packages = (sourceSettings.packages ?? []).map((entry) => {
  const source = typeof entry === "string" ? entry : entry.source;
  return path.join(setupHome, "packages", "active", path.basename(source));
});

fs.writeFileSync(
  settingsPath,
  JSON.stringify({ enableSkillCommands: true, packages }, null, 2) + "\n",
);
NODE

echo "Pi setup installed in $SETUP_HOME"
echo "Start Pi from any directory with: pi"
