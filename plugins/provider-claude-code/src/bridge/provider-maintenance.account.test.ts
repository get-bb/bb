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
  profile: null as Response | null,
  profileRequests: [] as Array<{ url: string; authorization: string | null }>,
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
        JSON.stringify(
          file.endsWith(".credentials.json")
            ? { claudeAiOauth: { accessToken: "stored-token" } }
            : {
                oauthAccount: {
                  accountUuid: "4f6c1d2e-8a9b-4c3d-9e1f-2a3b4c5d6e7f",
                },
              },
        ),
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
  state.profile = new Response("unavailable", { status: 503 });
  state.profileRequests = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    state.profileRequests.push({
      url,
      authorization: new Headers(init.headers).get("authorization"),
    });
    return Promise.resolve(state.profile);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function liveProfile(organizationType: string, rateLimitTier: string) {
  return Response.json({
    organization: {
      organization_type: organizationType,
      rate_limit_tier: rateLimitTier,
    },
  });
}

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
    expect(state.files).toEqual(
      expect.arrayContaining([
        path.join(profile, ".claude.json"),
        path.join(profile, ".credentials.json"),
      ]),
    );
  });

  it.each([
    ["claude_max", "default_claude_max_5x", "Max", "max"],
    ["claude_max", "default_claude_max_20x", "Ultra", "ultra"],
    ["claude_pro", "default_claude_ai", "Pro", "pro"],
  ])(
    "reports the live %s plan with tier %s over the plan Claude Code stored at login",
    async (organizationType, rateLimitTier, label, id) => {
      state.profile = liveProfile(organizationType, rateLimitTier);

      expect(await getClaudeProviderUsage()).toMatchObject({
        usage: { planLabel: label, plan: { id, multiplier: null } },
      });
      expect(state.profileRequests).toEqual([
        {
          url: "https://api.anthropic.com/api/oauth/profile",
          authorization: "Bearer stored-token",
        },
      ]);

      state.profile = liveProfile(organizationType, rateLimitTier);
      expect(await getClaudeProviderHealth()).toMatchObject({
        health: { status: "ready", planLabel: label },
      });
    },
  );

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
