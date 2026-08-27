// What this plugin promises today is narrow, so the tests are too: it must
// recognise an Auto selection, and it must never change or block a dispatch.
//
// The second half is the one that matters. Gates are fail-closed and run under
// a server-wide lock, so a gate that threw, held, or amended something core
// could not honour would break every send in the server with this plugin
// named. "Installed and idle" has to be provably indistinguishable from "not
// installed".

import type { PluginDispatchGateContext } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, {
  EMPTY_ROUTING_PROMPT,
  NO_INFERENCE_CONSUMER,
  readAutoEntry,
} from "./server.js";

const PLUGIN_ID = "model-router";

const PROJECT = {
  id: "proj_1",
  kind: "standard" as const,
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

function createContext(
  pluginInput: PluginDispatchGateContext<"thread.create">["pluginInput"],
): PluginDispatchGateContext<"thread.create"> {
  return {
    stage: "thread.create",
    thread: null,
    project: PROJECT,
    environment: null,
    host: null,
    input: { blocks: [], text: "refactor the dispatch pipeline" },
    requestedExecution: {
      providerId: "codex",
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    executionSources: {
      providerId: null,
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
    pluginInput,
    isReleaseReevaluation: false,
    hold: null,
  };
}

async function setup(settings: Record<string, string | boolean> = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings,
  });
  await plugin(bb);
  return harness;
}

describe("readAutoEntry", () => {
  it("accepts only an object carrying a non-empty string entry", () => {
    // `pluginInput` is freeform JSON off a request body, so every one of these
    // is reachable from a caller that guessed at the convention. Anything but
    // the real shape has to read as "did not pick Auto" rather than as an
    // entry named "undefined".
    expect(readAutoEntry({ entry: "default" })).toBe("default");
    expect(readAutoEntry({ entry: "fast", extra: 1 })).toBe("fast");
    expect(readAutoEntry(null)).toBeNull();
    expect(readAutoEntry("default")).toBeNull();
    expect(readAutoEntry(["default"])).toBeNull();
    expect(readAutoEntry({})).toBeNull();
    expect(readAutoEntry({ entry: "" })).toBeNull();
    expect(readAutoEntry({ entry: "   " })).toBeNull();
    expect(readAutoEntry({ entry: 7 })).toBeNull();
    expect(readAutoEntry({ entry: null })).toBeNull();
  });
});

describe("gates", () => {
  it("proceeds unamended at both stages whether or not Auto was picked", async () => {
    const harness = await setup({
      routingPrompt: "Fast for edits, capable for refactors.",
    });
    const create = harness.registrations.dispatchGates["thread.create"];
    const submit = harness.registrations.dispatchGates["turn.submit"];
    if (create === null || submit === null) {
      throw new Error("both dispatch gates must be registered");
    }

    const thread = makeThreadResponse({ id: "thr_1", projectId: PROJECT.id });
    for (const pluginInput of [{ entry: "default" }, null]) {
      // `proceed` with no `amend` key at all: an `amend: {}` would still be an
      // amendment record core has to validate and attribute to this plugin.
      expect(await create(createContext(pluginInput))).toEqual({
        action: "proceed",
      });
      expect(
        await submit({
          ...createContext(pluginInput),
          stage: "turn.submit",
          thread,
        }),
      ).toEqual({ action: "proceed" });
    }
  });
});

describe("status", () => {
  it("explains that routing is unavailable even when the prompt is set", async () => {
    const harness = await setup({
      routingPrompt: "Capable model for planning.",
    });
    expect(harness.needsConfigurationMessages.join(" ")).toContain(
      NO_INFERENCE_CONSUMER,
    );
    expect(harness.needsConfigurationMessages.join(" ")).not.toContain(
      EMPTY_ROUTING_PROMPT,
    );
  });

  it("also asks for a routing prompt when there is none", async () => {
    const harness = await setup();
    const reported = harness.needsConfigurationMessages.join(" ");
    expect(reported).toContain(EMPTY_ROUTING_PROMPT);
    expect(reported).toContain(NO_INFERENCE_CONSUMER);
  });
});
