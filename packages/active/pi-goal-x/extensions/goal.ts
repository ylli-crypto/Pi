/**
 * Goal extension — Claude Code-style simplicity.
 *
 * ONE tool:  `goal`   — the agent uses it to check/update status.
 * ONE command: `/goal`  — the user sets and writes the goal.
 *
 *   /goal                    → show current goal
 *   /goal <objective>        → set a new goal (user writes it)
 *   /goal clear             → remove the goal
 *
 * Storage: project-local `.pi/goals/current.json`
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

interface Goal {
	objective: string;
	status: "active" | "paused" | "complete";
	createdAt: string;
	updatedAt: string;
	note?: string;
}

const GOAL_DIR = ".pi/goals";
const GOAL_FILE = ".pi/goals/current.json";

function nowIso(): string {
	return new Date().toISOString();
}

function goalPath(cwd: string): string {
	return join(cwd, GOAL_FILE);
}

function loadGoal(cwd: string): Goal | null {
	const path = goalPath(cwd);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed.objective !== "string") return null;
		return parsed as Goal;
	} catch {
		return null;
	}
}

function saveGoal(cwd: string, goal: Goal): void {
	mkdirSync(join(cwd, GOAL_DIR), { recursive: true });
	writeFileSync(goalPath(cwd), JSON.stringify(goal, null, 2) + "\n");
}

function clearGoalFile(cwd: string): void {
	const path = goalPath(cwd);
	if (existsSync(path)) {
		try { unlinkSync(path); } catch { /* ignore */ }
	}
}

function refreshStatus(ctx: ExtensionContext): void {
	const goal = loadGoal(ctx.cwd);
	if (!goal || goal.status === "complete") {
		ctx.ui.setStatus("goal", undefined);
		return;
	}
	const icon = goal.status === "paused" ? "⏸" : "◆";
	const text = goal.objective.length > 60
		? goal.objective.slice(0, 57) + "…"
		: goal.objective;
	ctx.ui.setStatus("goal", `${icon} ${text}`);
}

export default function goalExtension(pi: ExtensionAPI): void {
	// ── ONE tool: goal ──────────────────────────────────────────────
	// The user sets the goal via /goal. The agent uses this tool to
	// check the objective and mark it complete / paused / resumed.
	pi.registerTool(defineTool({
		name: "goal",
		label: "Goal",
		description:
			"Get the current goal or update its status. The user sets the goal with /goal. " +
			"Use action=\"get\" to read the objective, action=\"complete\" when the work is done, " +
			"action=\"pause\" if you are blocked and need user input, action=\"resume\" to continue.",
		promptSnippet: "Check the current goal with action=\"get\". Mark it complete when done. Pause if blocked.",
		parameters: Type.Object({
			action: StringEnum(["get", "complete", "pause", "resume"], {
				description: "What to do with the current goal.",
			}),
			note: Type.Optional(Type.String({
				description: "Optional note explaining the status change (e.g. why paused).",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const goal = loadGoal(ctx.cwd);

			if (!goal) {
				return {
					content: [{
						type: "text",
						text: "No goal is set. The user can set one with /goal <objective>.",
					}],
				};
			}

			if (params.action === "get") {
				return {
					content: [{
						type: "text",
						text: `Goal: ${goal.objective}\nStatus: ${goal.status}\nSet: ${goal.createdAt}\nUpdated: ${goal.updatedAt}`,
					}],
				};
			}

			// status transitions
			const newStatus = params.action === "complete" ? "complete"
				: params.action === "pause" ? "paused"
				: params.action === "resume" ? "active"
				: null;

			if (!newStatus) {
				return { content: [{ type: "text", text: `Unknown action: ${params.action}` }] };
			}

			goal.status = newStatus as Goal["status"];
			if (params.note) goal.note = params.note;
			goal.updatedAt = nowIso();
			saveGoal(ctx.cwd, goal);
			refreshStatus(ctx);

			const verb = params.action === "complete" ? "✓ complete"
				: params.action === "pause" ? "⏸ paused"
				: "▶ resumed";
			ctx.ui.notify(`Goal ${verb}`, "info");

			if (params.action === "complete") {
				return {
					content: [{
						type: "text",
						text: `Goal marked complete: ${goal.objective}${params.note ? `\nNote: ${params.note}` : ""}`,
					}],
					terminate: true,
				};
			}

			return {
				content: [{
					type: "text",
					text: `Goal ${verb}: ${goal.objective}${params.note ? `\nNote: ${params.note}` : ""}`,
				}],
			};
		},
	}));

	// ── ONE command: /goal ──────────────────────────────────────────
	pi.registerCommand("goal", {
		description: "Set or show your goal. /goal <objective> to set, /goal to show, /goal clear to remove.",
		handler: async (rawArgs: string, ctx: ExtensionContext) => {
			const args = (rawArgs ?? "").trim();

			// /goal clear — remove the goal
			if (args.toLowerCase() === "clear") {
				clearGoalFile(ctx.cwd);
				ctx.ui.setStatus("goal", undefined);
				ctx.ui.notify("Goal cleared", "info");
				return;
			}

			// /goal (no args) — show current
			if (!args) {
				const goal = loadGoal(ctx.cwd);
				if (!goal) {
					ctx.ui.notify("No goal set. Use /goal <objective>", "info");
					return;
				}
				ctx.ui.notify(`Goal (${goal.status}): ${goal.objective}`, "info");
				refreshStatus(ctx);
				return;
			}

			// /goal <text> — set a new goal
			const goal: Goal = {
				objective: args,
				status: "active",
				createdAt: nowIso(),
				updatedAt: nowIso(),
			};
			saveGoal(ctx.cwd, goal);
			refreshStatus(ctx);
			ctx.ui.notify("✓ Goal set", "info");
		},
	});

	// refresh the status bar on startup
	pi.on("session_start", async (_event, ctx) => {
		if (ctx) refreshStatus(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (ctx) refreshStatus(ctx);
	});
}
