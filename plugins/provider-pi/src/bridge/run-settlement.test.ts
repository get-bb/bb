import { runInNewContext } from "node:vm";
import {
  VERSION,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import { runSettlementError } from "./run-settlement.js";

it.each([{}, { aborted: false }])(
  "does not infer interruption from prose: %j",
  (event) => {
    expect(
      runSettlementError(event, [
        {
          role: "assistant",
          stopReason: "stop",
          content: "I was aborted; continue?",
        },
      ]),
    ).toBeUndefined();
  },
);
it.each([null, "false", 0, {}, []])(
  "fails safely for malformed aborted=%j",
  (aborted) => {
    expect(runSettlementError({ aborted }, [])).toContain(
      "Invalid Pi settlement",
    );
  },
);
it("recognizes abort without an error message, including trailing tool results", () => {
  expect(
    runSettlementError({}, [
      { role: "assistant", stopReason: "aborted" },
      { role: "toolResult" },
    ]),
  ).toContain("interrupted");
  expect(
    runSettlementError({ aborted: false }, [
      { role: "assistant", stopReason: "aborted" },
    ]),
  ).toContain("interrupted");
  expect(runSettlementError({ aborted: true }, [])).toContain(
    "no automatic resume",
  );
  expect(
    runSettlementError({}, [{ role: "assistant", stopReason: "error" }]),
  ).toBe("Pi run failed");
});
it("uses the final assistant rather than earlier retry failures", () => {
  expect(
    runSettlementError({}, [
      { role: "assistant", stopReason: "error" },
      { role: "assistant", stopReason: "stop" },
    ]),
  ).toBeUndefined();
});

it.each([
  ["0.84.0", true],
  ["0.84.1", true],
  ["0.85.0", true],
  ["1.0.0", true],
  ["1.0.2", true],
  ["2.0.0", true],
  ["0.83.9", false],
  [undefined, false],
  ["unknown", false],
  ["1", false],
  ["0.84.0-beta.1", false],
  ["0.84.0+build", true],
])(
  "extension advertises authoritative settlement for runtime %s: %s",
  (version, expected) => {
    const definition = BB_PI_EXTENSION_SOURCE.match(
      /function supportsAgentSettlement\(version\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(definition).toBeDefined();
    expect(
      runInNewContext(`${definition}; supportsAgentSettlement(version)`, {
        version,
      }),
    ).toBe(expected);
  },
);

it("the installed official runtime exports VERSION and types agent_settled", () => {
  const event: AgentSessionEvent = { type: "agent_settled" };
  expect(event.type).toBe("agent_settled");
  const definition = BB_PI_EXTENSION_SOURCE.match(
    /function supportsAgentSettlement\(version\) \{[\s\S]*?\n\}/,
  )?.[0];
  expect(
    runInNewContext(`${definition}; supportsAgentSettlement(version)`, {
      version: VERSION,
    }),
  ).toBe(true);
});
