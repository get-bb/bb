import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "./decode.js";
import { createAcpSessionModel } from "./session-model.js";
import type { AcpSessionEvent } from "./session-types.js";

const RECORDINGS_ROOT = fileURLToPath(
  new URL(
    "../../../provider-bridge-protocol/recordings/acp-cursor",
    import.meta.url,
  ),
);

function recordedSessionUpdates(scenario: string): unknown[] {
  const path = join(RECORDINGS_ROOT, scenario, "provider→bridge.ndjson");
  const updates: unknown[] = [];
  if (!existsSync(path)) {
    return updates;
  }
  for (const row of readFileSync(path, "utf8").split("\n")) {
    if (row.trim() === "") {
      continue;
    }
    const recorded: unknown = JSON.parse(row);
    if (!isJsonObject(recorded) || typeof recorded["line"] !== "string") {
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(recorded["line"]);
    } catch {
      continue;
    }
    if (
      isJsonObject(message) &&
      message["method"] === "session/update" &&
      isJsonObject(message["params"])
    ) {
      updates.push(message["params"]["update"]);
    }
  }
  return updates;
}

const scenarios = readdirSync(RECORDINGS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((scenario) => recordedSessionUpdates(scenario).length > 0);

describe("recorded Cursor sessions", () => {
  it("finds recordings to replay", () => {
    expect(scenarios.length).toBeGreaterThan(5);
  });

  it.each(scenarios)(
    "decodes every update of %s without an unhandled event",
    (scenario) => {
      const model = createAcpSessionModel({ generation: 1 });
      const events: AcpSessionEvent[] = [...model.promptSubmitted()];
      for (const update of recordedSessionUpdates(scenario)) {
        events.push(...model.applySessionUpdate(update));
      }
      events.push(...model.promptSettled({ stopReason: "end_turn" }));
      expect(events.filter((event) => event.type === "unhandled")).toEqual([]);
      expect(model.snapshot().work.state).toBe("idle");
    },
  );
});
