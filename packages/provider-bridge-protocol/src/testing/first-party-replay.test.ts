import { expect, it } from "vitest";
import { resolveReplayProfile } from "./first-party-replay.js";

it("preserves legacy Codex turn recordings that used an empty environment to keep session values", () => {
  const rewrite = resolveReplayProfile("codex").rewriteRuntimeLine;
  const message = {
    jsonrpc: "2.0",
    id: 2,
    method: "turn/start",
    params: {
      threadId: "thr_recorded",
      options: { envVars: {}, permissionMode: "full" },
    },
  };
  const rewritten = rewrite?.(JSON.stringify(message), { replayCommand: [] });
  expect(JSON.parse(rewritten ?? "null")).toEqual({
    ...message,
    params: { ...message.params, options: { permissionMode: "full" } },
  });
  const changed = JSON.stringify({
    ...message,
    params: { ...message.params, options: { envVars: { ROTATED: "new" } } },
  });
  expect(rewrite?.(changed, { replayCommand: [] })).toBe(changed);
});
