import { chmod, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

import type { AuditEvent } from "./types.ts";

/** Prevent secrets and huge model inputs from becoming a durable audit record. */
export function redact(value: string, limit = 500): string {
  const scrubbed = value
    .replace(
      /(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s,'"`]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*)([^\s,'"`]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
  return scrubbed.length > limit ? `${scrubbed.slice(0, limit)}…` : scrubbed;
}

function sanitize(value: unknown, limit: number): unknown {
  if (typeof value === "string") return redact(value, limit);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, limit));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitize(item, limit),
      ]),
    );
  }
  return value;
}

export class AuditLog {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  append(event: AuditEvent, maxEntryChars: number, enabled: boolean): Promise<void> {
    if (!enabled) return Promise.resolve();
    const line = `${JSON.stringify({
      ...event,
      details: sanitize(event.details, maxEntryChars),
    })}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const handle = await open(this.path, "a", 0o600);
      try {
        await handle.chmod(0o600);
        await handle.writeFile(line, "utf8");
      } finally {
        await handle.close();
      }
    });
    return this.writeChain;
  }
}
