import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
  AllowRule,
  PermissionConfig,
  PresetName,
  RuleSurface,
} from "./types.ts";

const CONFIG_FILE = "config.json";
const VALID_PRESETS = new Set<PresetName>([
  "strict",
  "safe-developer",
  "convenient",
]);
const VALID_SURFACES = new Set<RuleSurface>([
  "tool",
  "tool-path",
  "bash",
  "mcp",
  "skill",
  "external",
]);

export function defaultConfig(): PermissionConfig {
  return {
    version: 1,
    preset: "safe-developer",
    disabled: false,
    ui: { doublePressToConfirm: true },
    audit: { enabled: true, maxEntryChars: 500 },
    rules: [],
  };
}

export function extensionDirectory(agentDir: string): string {
  return join(agentDir, "extensions", "pi-permissions");
}

export function configPath(agentDir: string): string {
  return join(extensionDirectory(agentDir), CONFIG_FILE);
}

export function auditPath(agentDir: string): string {
  return join(extensionDirectory(agentDir), "audit.jsonl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function parseRule(value: unknown): AllowRule | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.createdAt !== "string" ||
    value.source !== "user" ||
    !VALID_SURFACES.has(value.surface as RuleSurface)
  ) {
    return undefined;
  }
  if (value.surface === "tool-path" && typeof value.pattern !== "string") {
    return undefined;
  }
  if (value.pattern !== undefined && typeof value.pattern !== "string") {
    return undefined;
  }
  return {
    id: value.id,
    surface: value.surface as RuleSurface,
    subject: value.subject,
    ...(typeof value.pattern === "string" ? { pattern: value.pattern } : {}),
    createdAt: value.createdAt,
    source: "user",
  };
}

export function parseConfig(raw: unknown): PermissionConfig {
  const fallback = defaultConfig();
  if (!isRecord(raw) || raw.version !== 1) {
    throw new Error("config must be an object with version: 1");
  }

  const preset = VALID_PRESETS.has(raw.preset as PresetName)
    ? (raw.preset as PresetName)
    : fallback.preset;
  const ui = isRecord(raw.ui) ? raw.ui : {};
  const audit = isRecord(raw.audit) ? raw.audit : {};
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(parseRule).filter((rule): rule is AllowRule => rule !== undefined)
    : [];

  return {
    version: 1,
    preset,
    disabled: readBoolean(raw.disabled, fallback.disabled),
    ui: {
      doublePressToConfirm: readBoolean(
        ui.doublePressToConfirm,
        fallback.ui.doublePressToConfirm,
      ),
    },
    audit: {
      enabled: readBoolean(audit.enabled, fallback.audit.enabled),
      maxEntryChars: Math.min(
        readPositiveInteger(audit.maxEntryChars, fallback.audit.maxEntryChars),
        4000,
      ),
    },
    rules,
  };
}

export class PermissionConfigStore {
  private config: PermissionConfig = defaultConfig();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private lastLoadError: string | undefined;
  readonly agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  get path(): string {
    return configPath(this.agentDir);
  }

  get auditLogPath(): string {
    return auditPath(this.agentDir);
  }

  get current(): PermissionConfig {
    return this.config;
  }

  get loadError(): string | undefined {
    return this.lastLoadError;
  }

  async load(): Promise<PermissionConfig> {
    try {
      const text = await readFile(this.path, "utf8");
      this.config = parseConfig(JSON.parse(text));
      this.lastLoadError = undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.config = defaultConfig();
        this.lastLoadError = undefined;
        await this.persist(this.config);
      } else {
        // A malformed policy must not silently become permissive. Strict is the
        // least disruptive fail-closed preset while still permitting ls/pwd.
        this.config = { ...defaultConfig(), preset: "strict" };
        this.lastLoadError = error instanceof Error ? error.message : String(error);
      }
    }
    this.loaded = true;
    return this.config;
  }

  async ensureLoaded(): Promise<PermissionConfig> {
    if (!this.loaded) await this.load();
    return this.config;
  }

  async update(mutator: (config: PermissionConfig) => PermissionConfig): Promise<PermissionConfig> {
    await this.ensureLoaded();
    let result = this.config;
    const pending = this.enqueue(async () => {
      const candidate = mutator(structuredClone(this.config));
      // Validate the full object before replacing the old configuration.
      const parsed = parseConfig(candidate);
      await this.writeAtomically(parsed);
      this.config = parsed;
      result = parsed;
    });
    await pending;
    return result;
  }

  async addRule(rule: Omit<AllowRule, "id" | "createdAt" | "source">): Promise<AllowRule> {
    const saved: AllowRule = {
      ...rule,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      source: "user",
    };
    await this.update((config) => ({ ...config, rules: [...config.rules, saved] }));
    return saved;
  }

  async removeRule(id: string): Promise<boolean> {
    let removed = false;
    await this.update((config) => {
      const rules = config.rules.filter((rule) => rule.id !== id);
      removed = rules.length !== config.rules.length;
      return { ...config, rules };
    });
    return removed;
  }

  async setPreset(preset: PresetName): Promise<void> {
    if (!VALID_PRESETS.has(preset)) throw new Error(`Unknown preset: ${preset}`);
    await this.update((config) => ({ ...config, preset }));
  }

  async clearRules(): Promise<void> {
    await this.update((config) => ({ ...config, rules: [] }));
  }

  private async persist(config: PermissionConfig): Promise<void> {
    await this.enqueue(() => this.writeAtomically(config));
  }

  /**
   * A failed disk write is reported to its caller, but must not poison the
   * serialized queue: a user can correct permissions and save a later rule
   * without restarting Pi.
   */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const pending = this.writeChain.catch(() => undefined).then(task);
    this.writeChain = pending.catch(() => undefined);
    return pending;
  }

  private async writeAtomically(config: PermissionConfig): Promise<void> {
    const directory = dirname(this.path);
    const temporaryPath = join(
      directory,
      `.${basename(this.path)}.${process.pid}.${Date.now()}.tmp`,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
