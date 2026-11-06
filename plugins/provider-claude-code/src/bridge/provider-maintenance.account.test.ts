import type {
  AccountInfo,
  SDKControlGetUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: {} as AccountInfo,
  usage: {} as Pick<
    SDKControlGetUsageResponse,
    "rate_limits_available" | "rate_limits"
  >,
  files: [] as string[],
}));

vi.mock("./initialization-probe.js", () => ({
  probeClaudeInitialization: () => Promise.resolve({ account: state.account }),
  probeClaudeUsage: () =>
    Promise.resolve({ account: state.account, usage: state.usage }),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) => {
      state.files.push(file);
      return Promise.resolve(
        JSON.stringify({
          oauthAccount: {
            accountUuid: "4f6c1d2e-8a9b-4c3d-9e1f-2a3b4c5d6e7f",
          },
        }),
      );
    },
  },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
  experimental_readCliVersion: () => Promise.resolve("2.1.317"),
}));

import {
  getClaudeProviderHealth,
  getClaudeProviderUsage,
} from "./provider-maintenance.js";

const signedIn: AccountInfo = {
  email: "claude@example.com",
  subscriptionType: "Claude Ultra",
  apiProvider: "firstParty",
};
const signedOut: AccountInfo = {
  tokenSource: "none",
  apiProvider: "firstParty",
};

beforeEach(() => {
  state.account = signedIn;
  state.usage = {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 40, resets_at: "2026-11-05T20:00:00Z" },
      seven_day: null,
    },
  };
  state.files = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Claude Code account status", () => {
  it("reports the account Claude Code signs in with, keyed by the profile CLAUDE_CONFIG_DIR selects", async () => {
    const profile = path.resolve("/profiles/work");
    vi.stubEnv("CLAUDE_CONFIG_DIR", profile);

    expect(await getClaudeProviderUsage()).toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: "claude@example.com",
        planLabel: "Ultra",
        plan: { id: "ultra", multiplier: null },
        windows: [
          {
            kind: "five-hour",
            label: "Current session",
            usedPercent: 40,
            resetsAt: "2026-11-05T20:00:00.000Z",
          },
        ],
        accountKey: "anthropic:account:4f6c1d2e-8a9b-4c3d-9e1f-2a3b4c5d6e7f",
      },
    });
    expect(state.files).toEqual([path.join(profile, ".claude.json")]);
  });

  it.each([
    ["Claude Code has no usable login", signedOut, true],
    ["plan limits do not apply to the login", signedIn, false],
  ])(
    "reports usage as signed out when %s",
    async (_case, account, rateLimitsAvailable) => {
      state.account = account;
      state.usage = {
        rate_limits_available: rateLimitsAvailable,
        rate_limits: null,
      };

      expect(await getClaudeProviderUsage()).toEqual({
        supported: true,
        usage: { status: "unauthenticated" },
      });
    },
  );

  it("reports health from the account Claude Code signs in with", async () => {
    expect(await getClaudeProviderHealth()).toMatchObject({
      health: {
        status: "ready",
        accountEmail: "claude@example.com",
        planLabel: "Ultra",
      },
    });

    state.account = signedOut;
    expect(await getClaudeProviderHealth()).toMatchObject({
      health: { status: "unauthenticated", accountEmail: null },
    });
  });
});
