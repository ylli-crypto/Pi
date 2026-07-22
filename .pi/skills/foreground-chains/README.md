# Pi Foreground Chains

A skill for [Pi coding agent](https://github.com/badlogic/pi-mono/) that orchestrates multi-agent workflows with full user visibility. Each step runs in an observable overlay where the user watches and can intervene.

**Requires:** [pi-interactive-shell](https://github.com/nicobailon/pi-interactive-shell) extension

## What It Does

Chains multiple AI agents together with file-based handoff:

```
Scout ──► context.md ──► Planner ──► plan.md ──► Worker ──► impl.md ──► Reviewer
                                                                            │
                                                                      progress.md
                                                                    (complete history)
```

Each agent runs in a hands-free overlay. The user watches in real-time and can take over anytime.

## Install

```bash
mkdir -p ~/.pi/agent/skills/foreground-chains
curl -o ~/.pi/agent/skills/foreground-chains/SKILL.md \
  https://raw.githubusercontent.com/nicobailon/pi-foreground-chains/main/SKILL.md
```

Or clone:

```bash
git clone https://github.com/nicobailon/pi-foreground-chains.git \
  ~/.pi/agent/skills/foreground-chains
```

Restart pi to load the skill.

## Prerequisites

Install the interactive-shell extension first:

```bash
npx pi-interactive-shell
```

## Usage

The skill teaches pi how to orchestrate multi-agent chains. Once installed, pi can:

- Run scout → planner → worker → reviewer workflows
- Use file-based handoff through chain directories
- Auto-continue agents that pause with "Should I...?" prompts
- Track progress in a single `progress.md` file

See [SKILL.md](./SKILL.md) for complete documentation and examples.

## Agent Roles

| Role | Purpose |
|------|---------|
| **Scout** | Fast codebase scanning, gathers context |
| **Planner** | Creates implementation plan from context |
| **Worker** | Implements the plan (with auto-continue) |
| **Reviewer** | Validates and fixes issues |

## License

MIT
