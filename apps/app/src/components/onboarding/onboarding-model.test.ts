import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import type {
  HostDiscoveredRepo,
  ServerAccessStatus,
  SystemProviderState,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  connectAccessUrl,
  defaultSelectedRepoPaths,
  hasReadyAgent,
  mostRecentImportedProjectId,
  parseSignInOutput,
  resolveAgentSetupState,
  resolveSignInCommand,
  shortRemoteName,
} from "./onboarding-model";

function health(
  overrides: Partial<SystemProviderState> = {},
): SystemProviderState {
  return {
    providerId: "claude-code",
    displayName: "Claude Code",
    status: "ready",
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: "2.1.0",
    minimumSupportedVersion: null,
    canInstall: true,
    canUpdate: true,
    loginCommand: "claude auth login",
    localLoginCommand: null,
    ...overrides,
  };
}

function cliStatus(
  overrides: Partial<ProviderCliStatus> = {},
): ProviderCliStatus {
  return {
    displayName: "Claude Code",
    executableName: "claude",
    executablePath: null,
    installed: false,
    installSource: "notInstalled",
    currentVersion: null,
    latestVersion: "2.1.0",
    minimumSupportedVersion: null,
    npmPackageName: "@anthropic-ai/claude-code",
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install",
      label: "Install",
      command: "npm install -g @anthropic-ai/claude-code",
    },
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

const idle = {
  installing: false,
  installFailure: null,
  signingIn: false,
  signInFailed: false,
  installInfoPending: false,
};

describe("resolveAgentSetupState", () => {
  it("shows the account and plan for a ready agent, even while a stale install job lingers", () => {
    expect(
      resolveAgentSetupState({
        health: health({ accountEmail: "a@b.dev", planLabel: "Max (20x)" }),
        cliStatus: cliStatus(),
        installing: true,
        installFailure: "old failure",
        signingIn: true,
        signInFailed: true,
        installInfoPending: true,
      }),
    ).toEqual({ status: "ready", detail: "a@b.dev · Max (20x)" });
    expect(
      resolveAgentSetupState({
        health: health(),
        cliStatus: undefined,
        ...idle,
      }),
    ).toEqual({ status: "ready", detail: null });
  });

  it("offers install only when the machine reports an install action", () => {
    expect(
      resolveAgentSetupState({
        health: health({ status: "not_installed" }),
        cliStatus: cliStatus(),
        ...idle,
      }),
    ).toEqual({ status: "install", canInstall: true });
    expect(
      resolveAgentSetupState({
        health: health({ status: "not_installed" }),
        cliStatus: cliStatus({ installAction: null }),
        ...idle,
      }),
    ).toEqual({ status: "install", canInstall: false });
    expect(
      resolveAgentSetupState({
        health: health({ status: "not_installed" }),
        cliStatus: undefined,
        ...idle,
      }),
    ).toEqual({ status: "install", canInstall: false });
  });

  it("keeps a missing agent in checking until install info has loaded", () => {
    expect(
      resolveAgentSetupState({
        health: health({ status: "not_installed" }),
        cliStatus: undefined,
        ...idle,
        installInfoPending: true,
      }),
    ).toEqual({ status: "checking" });
    expect(
      resolveAgentSetupState({
        health: health({ status: "unauthenticated" }),
        cliStatus: undefined,
        ...idle,
        installInfoPending: true,
      }),
    ).toEqual({ status: "signIn", reason: "signedOut", canSignIn: true });
  });

  it("reports a running install before a previous failure, and a failure before the health state", () => {
    const base = {
      health: health({ status: "not_installed" }),
      cliStatus: cliStatus(),
      signingIn: false,
      signInFailed: false,
      installInfoPending: false,
    };
    expect(
      resolveAgentSetupState({
        ...base,
        installing: true,
        installFailure: "Install failed.",
      }),
    ).toEqual({ status: "installing" });
    expect(
      resolveAgentSetupState({
        ...base,
        installing: false,
        installFailure: "Install failed.",
      }),
    ).toEqual({
      status: "installFailed",
      message: "Install failed.",
      canInstall: true,
    });
  });

  it("distinguishes signed out from expired and hides sign-in without a login command", () => {
    expect(
      resolveAgentSetupState({
        health: health({ status: "unauthenticated" }),
        cliStatus: undefined,
        ...idle,
      }),
    ).toEqual({ status: "signIn", reason: "signedOut", canSignIn: true });
    expect(
      resolveAgentSetupState({
        health: health({ status: "expired", loginCommand: null }),
        cliStatus: undefined,
        ...idle,
      }),
    ).toEqual({ status: "signIn", reason: "expired", canSignIn: false });
    expect(
      resolveAgentSetupState({
        health: health({ status: "unauthenticated" }),
        cliStatus: undefined,
        ...idle,
        signingIn: true,
      }),
    ).toEqual({ status: "signingIn" });
    expect(
      resolveAgentSetupState({
        health: health({ status: "unauthenticated" }),
        cliStatus: undefined,
        ...idle,
        signInFailed: true,
      }),
    ).toEqual({ status: "signIn", reason: "failed", canSignIn: true });
  });

  it("explains an unsupported version and passes unknown health through", () => {
    expect(
      resolveAgentSetupState({
        health: health({
          status: "unsupported_version",
          minimumSupportedVersion: "0.84.0",
        }),
        cliStatus: cliStatus({
          installed: true,
          installAction: {
            kind: "update",
            label: "Update",
            command: "npm install -g pi",
          },
        }),
        ...idle,
      }),
    ).toEqual({
      status: "update",
      detail: "Needs version 0.84.0 or newer",
      canInstall: true,
    });
    expect(
      resolveAgentSetupState({
        health: health({
          status: "unknown",
          statusMessage: "Machine is paused.",
        }),
        cliStatus: undefined,
        ...idle,
      }),
    ).toEqual({ status: "unknown", message: "Machine is paused." });
  });
});

describe("resolveSignInCommand", () => {
  const codex = {
    loginCommand: "codex login --device-auth",
    localLoginCommand: "codex login",
  };

  it("uses the browser login only when the browser is on the machine being signed in", () => {
    expect(resolveSignInCommand(codex, true)).toBe("codex login");
    expect(resolveSignInCommand(codex, false)).toBe(
      "codex login --device-auth",
    );
  });

  it("falls back to the one login an agent declares, wherever the browser is", () => {
    const claude = {
      loginCommand: "claude auth login",
      localLoginCommand: null,
    };

    expect(resolveSignInCommand(claude, true)).toBe("claude auth login");
    expect(resolveSignInCommand(claude, false)).toBe("claude auth login");
    expect(
      resolveSignInCommand(
        { loginCommand: null, localLoginCommand: null },
        true,
      ),
    ).toBeNull();
  });
});

describe("agent readiness summaries", () => {
  it("reports readiness only when an agent is ready", () => {
    const signedOut = health({ status: "unauthenticated" });
    const unknown = health({ providerId: "pi", status: "unknown" });

    expect(hasReadyAgent([signedOut, health()])).toBe(true);
    expect(hasReadyAgent([signedOut, unknown])).toBe(false);
    expect(hasReadyAgent(undefined)).toBe(false);
  });
});

function repo(overrides: Partial<HostDiscoveredRepo>): HostDiscoveredRepo {
  return {
    path: "/home/user/code/app",
    name: "app",
    lastActivityAt: "2026-10-07T00:00:00.000Z",
    originUrl: null,
    projectId: null,
    ...overrides,
  };
}

describe("defaultSelectedRepoPaths", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");

  it("preselects repos touched in the last week that are not projects yet", () => {
    expect(
      defaultSelectedRepoPaths(
        [
          repo({ path: "/a", lastActivityAt: "2026-10-07T00:00:00.000Z" }),
          repo({
            path: "/b",
            lastActivityAt: "2026-10-06T00:00:00.000Z",
            projectId: "proj_b",
          }),
          repo({ path: "/c", lastActivityAt: "2026-09-20T00:00:00.000Z" }),
        ],
        now,
      ),
    ).toEqual(new Set(["/a"]));
  });

  it("preselects at most the five most recent repos", () => {
    const repos = Array.from({ length: 8 }, (_, index) =>
      repo({
        path: `/repo-${index}`,
        lastActivityAt: new Date(now - index * 3_600_000).toISOString(),
      }),
    );

    expect(defaultSelectedRepoPaths(repos, now)).toEqual(
      new Set(["/repo-0", "/repo-1", "/repo-2", "/repo-3", "/repo-4"]),
    );
  });

  it("falls back to the newest importable repo when nothing is that recent", () => {
    expect(
      defaultSelectedRepoPaths(
        [
          repo({
            path: "/added",
            lastActivityAt: "2026-09-25T00:00:00.000Z",
            projectId: "proj_added",
          }),
          repo({ path: "/older", lastActivityAt: "2026-09-20T00:00:00.000Z" }),
          repo({ path: "/oldest", lastActivityAt: "2026-09-10T00:00:00.000Z" }),
        ],
        now,
      ),
    ).toEqual(new Set(["/older"]));
    expect(defaultSelectedRepoPaths([], now)).toEqual(new Set());
  });
});

describe("mostRecentImportedProjectId", () => {
  it("picks the imported project whose repo was active most recently", () => {
    expect(
      mostRecentImportedProjectId([
        { projectId: "proj_old", lastActivityAt: "2026-09-20T00:00:00.000Z" },
        { projectId: "proj_new", lastActivityAt: "2026-10-07T00:00:00.000Z" },
        { projectId: "proj_mid", lastActivityAt: "2026-10-01T00:00:00.000Z" },
      ]),
    ).toBe("proj_new");
  });

  it("returns null when nothing was imported", () => {
    expect(mostRecentImportedProjectId([])).toBeNull();
  });
});

describe("shortRemoteName", () => {
  it.each([
    ["git@github.com:get-bb/bb.git", "get-bb/bb"],
    ["https://github.com/get-bb/bb", "get-bb/bb"],
    ["https://github.com/get-bb/bb.git/", "get-bb/bb"],
    ["ssh://git@gitlab.example.com:2222/group/sub/repo.git", "sub/repo"],
    ["https://token@dev.azure.com/org/project/_git/repo", "_git/repo"],
  ])("shortens %s", (url, expected) => {
    expect(shortRemoteName(url)).toBe(expected);
  });

  it("returns null without a remote or without an owner segment", () => {
    expect(shortRemoteName(null)).toBeNull();
    expect(shortRemoteName("/srv/git/repo.git")).toBeNull();
    expect(shortRemoteName("localhost:repo.git")).toBeNull();
  });
});

describe("connectAccessUrl", () => {
  function access(
    providers: ServerAccessStatus["providers"],
  ): ServerAccessStatus {
    return {
      providers,
      defaultProviderId: "connect",
      effectiveUrl: null,
      urlSource: null,
    };
  }
  const connect = {
    id: "connect",
    displayName: "bb connect",
    description: "",
    pluginId: "connect",
  };

  it("is on only when bb connect is available with an address", () => {
    expect(
      connectAccessUrl(
        access([
          {
            ...connect,
            availability: {
              status: "available",
              serverUrl: "https://sawyer.getbb.app",
            },
          },
        ]),
      ),
    ).toEqual({ status: "on", url: "https://sawyer.getbb.app" });
    expect(
      connectAccessUrl(
        access([{ ...connect, availability: { status: "available" } }]),
      ),
    ).toEqual({ status: "off" });
    expect(
      connectAccessUrl(
        access([
          {
            ...connect,
            availability: { status: "setup-required", message: "Sign in" },
          },
        ]),
      ),
    ).toEqual({ status: "off" });
  });

  it("is unavailable when the connect plugin provides no access method", () => {
    expect(
      connectAccessUrl(
        access([
          {
            id: "direct",
            displayName: "Direct",
            description: "",
            pluginId: null,
            availability: {
              status: "available",
              serverUrl: "https://bb.example.com",
            },
          },
        ]),
      ),
    ).toEqual({ status: "unavailable" });
    expect(connectAccessUrl(undefined)).toEqual({ status: "unavailable" });
  });
});

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=tabUM2J3-ABCD";

describe("parseSignInOutput", () => {
  it("shows only a link for Codex's browser login, which needs no code", () => {
    const output = [
      "Starting local login server on http://localhost:1455.\r\n",
      "If your browser did not open, navigate to this URL to authenticate:\r\n\r\n",
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&state=L0qZB807yNu-ZBqrvo6vcNcN_URyZ\r\n\r\n",
      "On a remote or headless machine? Use `codex login --device-auth` instead.\r\n",
    ].join("");

    expect(parseSignInOutput(output)).toEqual({
      url: "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&state=L0qZB807yNu-ZBqrvo6vcNcN_URyZ",
      userCode: null,
      acceptsPastedCode: false,
    });
  });

  it("lifts the link and the paste prompt out of Claude Code's login output", () => {
    const output = [
      "Opening browser to sign in…\r\n",
      `If the browser didn't open, visit: ${ESC}]8;;${CLAUDE_URL}${BEL}${ESC}[94m${CLAUDE_URL}${ESC}[39m${ESC}]8;;${BEL}\r\n`,
      "Paste code here if prompted > ",
    ].join("");

    expect(parseSignInOutput(output)).toEqual({
      url: CLAUDE_URL,
      userCode: null,
      acceptsPastedCode: true,
    });
  });

  it("lifts the link and the one-time code out of Codex's device login output", () => {
    const output = [
      "\r\n",
      `Welcome to Codex [v${ESC}[90m0.161.0${ESC}[0m]\r\n`,
      "Follow these steps to sign in with ChatGPT using device code authorization:\r\n\r\n",
      "1. Open this link in your browser and sign in to your account\r\n",
      `   ${ESC}[94mhttps://auth.openai.com/codex/device${ESC}[0m\r\n\r\n`,
      `2. Enter this one-time code ${ESC}[90m(expires in 15 minutes)${ESC}[0m\r\n`,
      `   ${ESC}[94mJWMS-GLRCB${ESC}[0m\r\n\r\n`,
      "Continue only if you started this login in Codex.\r\n",
    ].join("");

    expect(parseSignInOutput(output)).toEqual({
      url: "https://auth.openai.com/codex/device",
      userCode: "JWMS-GLRCB",
      acceptsPastedCode: false,
    });
  });

  it("takes the whole link from the terminal hyperlink when the visible text is wrapped", () => {
    const wrapped = `${CLAUDE_URL.slice(0, 60)}\r\n${CLAUDE_URL.slice(60)}`;
    const output = `visit: ${ESC}]8;;${CLAUDE_URL}${BEL}${wrapped}${ESC}]8;;${BEL}\r\nPaste code here if prompted > `;

    expect(parseSignInOutput(output).url).toBe(CLAUDE_URL);
  });

  it("does not mistake part of a link for a one-time code", () => {
    expect(
      parseSignInOutput(
        "Visit https://example.com/auth?state=ABCD-EFGH&x=WXYZ-12345 to sign in\n",
      ),
    ).toEqual({
      url: "https://example.com/auth?state=ABCD-EFGH&x=WXYZ-12345",
      userCode: null,
      acceptsPastedCode: false,
    });
  });

  it("reports nothing to act on before the command has printed a link", () => {
    expect(parseSignInOutput("")).toEqual({
      url: null,
      userCode: null,
      acceptsPastedCode: false,
    });
    expect(
      parseSignInOutput(`${ESC}[2J${ESC}[HChoose a text style\r\n`),
    ).toEqual({
      url: null,
      userCode: null,
      acceptsPastedCode: false,
    });
  });
});
