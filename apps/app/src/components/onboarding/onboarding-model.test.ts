import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import type {
  HostDiscoveredRepo,
  ServerAccessStatus,
  SystemProviderState,
} from "@bb/server-contract";
import { BbHttpError, BbRequestTimeoutError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  agentContinueDisabled,
  agentRowSetup,
  agentSignInView,
  connectAccessUrl,
  devicesShowMachines,
  connectFlowFailed,
  defaultSelectedRepoPaths,
  skippedStepIds,
  hasReadyAgent,
  operationFailureReason,
  parseSignInOutput,
  projectsPrimaryAction,
  resolveAgentSetupState,
  setupGuidePlanHealth,
  resolveSignInCommand,
  signInBrowserIsOnMachine,
  shortRemoteName,
  signInSiteName,
  terminalConnectFlow,
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
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
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
  whileInstallInfoPending: "checking" as const,
};

describe("resolveAgentSetupState", () => {
  it("shows Codex's plan only in the new guide; today's guide shows main's line", () => {
    const codex = health({
      providerId: "codex",
      accountEmail: "a@b.dev",
      internal_DO_NOT_USE_setupGuidePlanLabel: "Plus",
    });
    expect(
      resolveAgentSetupState({ ...idle, health: codex, cliStatus: undefined }),
    ).toEqual({ status: "ready", detail: "a@b.dev" });
    expect(
      resolveAgentSetupState({
        ...idle,
        health: setupGuidePlanHealth(codex),
        cliStatus: undefined,
      }),
    ).toEqual({ status: "ready", detail: "a@b.dev · Plus" });
    expect(
      setupGuidePlanHealth(health({ planLabel: "Max (20x)" })).planLabel,
    ).toBe("Max (20x)");
  });

  it("shows the account and plan for a ready agent, even while a stale install job lingers", () => {
    expect(
      resolveAgentSetupState({
        health: health({ accountEmail: "a@b.dev", planLabel: "Ultra" }),
        cliStatus: cliStatus(),
        installing: true,
        installFailure: "old failure",
        signingIn: true,
        signInFailed: true,
        installInfoPending: true,
        whileInstallInfoPending: "checking",
      }),
    ).toEqual({ status: "ready", detail: "a@b.dev · Ultra" });
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

  it("offers Install or Update in the new guide while install info is still loading", () => {
    const pending = {
      ...idle,
      cliStatus: undefined,
      installInfoPending: true,
      whileInstallInfoPending: "offerInstall" as const,
    };
    expect(
      resolveAgentSetupState({
        ...pending,
        health: health({ status: "not_installed" }),
      }),
    ).toEqual({ status: "install", canInstall: true });
    expect(
      resolveAgentSetupState({
        ...pending,
        health: health({
          status: "unsupported_version",
          minimumSupportedVersion: "2.0.0",
        }),
      }),
    ).toEqual({
      status: "update",
      detail: "Needs version 2.0.0 or newer",
      canInstall: true,
    });
    expect(
      resolveAgentSetupState({
        ...pending,
        installInfoPending: false,
        health: health({ status: "not_installed" }),
      }),
    ).toEqual({ status: "install", canInstall: false });
  });

  it("reports a running install before a previous failure, and a failure before the health state", () => {
    const base = {
      health: health({ status: "not_installed" }),
      cliStatus: cliStatus(),
      signingIn: false,
      signInFailed: false,
      installInfoPending: false,
      whileInstallInfoPending: "checking" as const,
    };
    expect(
      resolveAgentSetupState({
        ...base,
        installing: true,
        installFailure: "Install failed.",
      }),
    ).toEqual({ status: "installing", update: false });
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

    expect(parseSignInOutput(output, "last")).toEqual({
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

    expect(parseSignInOutput(output, "last")).toEqual({
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

    expect(parseSignInOutput(output, "last")).toEqual({
      url: "https://auth.openai.com/codex/device",
      userCode: "JWMS-GLRCB",
      acceptsPastedCode: false,
    });
  });

  it("takes the whole link from the terminal hyperlink when the visible text is wrapped", () => {
    const wrapped = `${CLAUDE_URL.slice(0, 60)}\r\n${CLAUDE_URL.slice(60)}`;
    const output = `visit: ${ESC}]8;;${CLAUDE_URL}${BEL}${wrapped}${ESC}]8;;${BEL}\r\nPaste code here if prompted > `;

    expect(parseSignInOutput(output, "last").url).toBe(CLAUDE_URL);
  });

  it("does not mistake part of a link for a one-time code", () => {
    expect(
      parseSignInOutput(
        "Visit https://example.com/auth?state=ABCD-EFGH&x=WXYZ-12345 to sign in\n",
        "last",
      ),
    ).toEqual({
      url: "https://example.com/auth?state=ABCD-EFGH&x=WXYZ-12345",
      userCode: null,
      acceptsPastedCode: false,
    });
  });

  it("reports nothing to act on before the command has printed a link", () => {
    expect(parseSignInOutput("", "last")).toEqual({
      url: null,
      userCode: null,
      acceptsPastedCode: false,
    });
    expect(
      parseSignInOutput(`${ESC}[2J${ESC}[HChoose a text style\r\n`, "last"),
    ).toEqual({
      url: null,
      userCode: null,
      acceptsPastedCode: false,
    });
  });
});

describe("operationFailureReason", () => {
  it.each([
    ["host_unavailable", 502, "host_unavailable"],
    ["command_timeout", 502, "timed_out"],
    [null, 504, "timed_out"],
    ["project_not_found", 404, "not_found"],
    ["unauthorized", 401, "permission"],
    ["forbidden", 403, "permission"],
    ["project_not_found", 502, "other"],
    [null, 500, "other"],
  ] as const)(
    "maps the %s error code with status %s to %s",
    (code, status, reason) => {
      expect(
        operationFailureReason(
          new BbHttpError({ body: null, code, message: "failed", status }),
        ),
      ).toBe(reason);
    },
  );

  it("reports a request that ran out of time as timed out", () => {
    expect(operationFailureReason(new BbRequestTimeoutError(30_000))).toBe(
      "timed_out",
    );
  });

  it("reports errors without an HTTP status as other", () => {
    expect(operationFailureReason(new TypeError("Failed to fetch"))).toBe(
      "other",
    );
  });
});

const PI_AUTH_URL =
  "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=MXdVe-PfEWSN";
const PI_CHANGELOG_URL = "https://pi.dev/changelog";
const PI_LOGIN_OUTPUT = [
  `${ESC}[90mNew version 1.6.0 is available. Changelog: ${ESC}]8;;${PI_CHANGELOG_URL}${BEL}${PI_CHANGELOG_URL}${ESC}]8;;${BEL}\r\n`,
  `${ESC}[2K Login to Anthropic\r\n`,
  `${ESC}[2K ${ESC}[38;5;6m${ESC}]8;;${PI_AUTH_URL}${BEL}${PI_AUTH_URL.slice(0, 88)}${ESC}]8;;${BEL}\r\n`,
  `${ESC}[2K ${ESC}]8;;${PI_AUTH_URL}${BEL}${PI_AUTH_URL.slice(88)}${ESC}]8;;${BEL}${ESC}[39m\r\n`,
  `${ESC}[2K ${ESC}[2m${ESC}]8;;${PI_AUTH_URL}${BEL}Ctrl+click to open${ESC}]8;;${BEL}${ESC}[22m • ctrl+x to copy\r\n`,
  `${ESC}[2K Paste the code Anthropic shows after you sign in:\r\n`,
  `${ESC}[2K > `,
].join("");
const PI_LOGIN_FAILED_OUTPUT = `${PI_LOGIN_OUTPUT}\r\n${ESC}[7;1H${ESC}[2K${ESC}[0m${ESC}]8;;${BEL}${ESC}[8;1H${ESC}[2K ${ESC}[38;5;1mError: Failed to login to Anthropic: OAuth state mismatch${ESC}[39m     `;

describe("Pi's sign-in", () => {
  it("takes the sign-in link Pi shows last, not an earlier link", () => {
    expect(parseSignInOutput(PI_LOGIN_OUTPUT, "last")).toEqual({
      url: PI_AUTH_URL,
      userCode: null,
      acceptsPastedCode: true,
    });
  });

  it("keeps today's guide on the first terminal link, as on main", () => {
    expect(parseSignInOutput(PI_LOGIN_OUTPUT, "first").url).toBe(
      PI_CHANGELOG_URL,
    );
    expect(
      agentSignInView({
        parsed: true,
        connect: false,
        outputText: PI_LOGIN_OUTPUT,
        fallbackDue: false,
        terminalChoice: null,
        signInLink: "first",
      }).guide?.url,
    ).toBe(PI_CHANGELOG_URL);
  });

  it("shows Pi's row like every other agent's until its sign-in terminal exists", () => {
    expect(agentRowSetup({ connect: true, awaitingSession: true })).toBe(
      "signIn",
    );
    expect(agentRowSetup({ connect: true, awaitingSession: false })).toBe(
      "connect",
    );
    expect(agentRowSetup({ connect: false, awaitingSession: false })).toBe(
      "signIn",
    );
  });

  it("sees a failed sign-in although Pi keeps running at its prompt", () => {
    const flow = terminalConnectFlow("pi");
    if (flow === null) throw new Error("Pi has no connect flow");

    expect(connectFlowFailed(flow, PI_LOGIN_OUTPUT)).toBe(false);
    expect(connectFlowFailed(flow, PI_LOGIN_FAILED_OUTPUT)).toBe(true);
  });
});

describe("skippedStepIds", () => {
  it("marks only the steps whose last forward move was a skip", () => {
    expect(
      [
        ...skippedStepIds(
          new Map([
            ["agent", "skipped"],
            ["projects", "completed"],
            ["plugins", "skipped"],
          ] as const),
        ),
      ].sort(),
    ).toEqual(["agent", "plugins"]);
  });
});

describe("projectsPrimaryAction", () => {
  const atOpen = new Set(["prj_existing"]);

  it("imports the selection", () => {
    expect(
      projectsPrimaryAction({
        selectedCount: 2,
        existingProjectIds: atOpen,
        projectIds: ["prj_existing"],
      }),
    ).toBe("import");
  });

  it("completes the step when a folder was added during the guide", () => {
    expect(
      projectsPrimaryAction({
        selectedCount: 0,
        existingProjectIds: atOpen,
        projectIds: ["prj_existing", "prj_added_folder"],
      }),
    ).toBe("completed");
  });

  it("skips the step when nothing was selected or added, counting earlier projects as not added", () => {
    expect(
      projectsPrimaryAction({
        selectedCount: 0,
        existingProjectIds: atOpen,
        projectIds: ["prj_existing"],
      }),
    ).toBe("skipped");
    expect(
      projectsPrimaryAction({
        selectedCount: 0,
        existingProjectIds: null,
        projectIds: ["prj_existing"],
      }),
    ).toBe("skipped");
  });
});

describe("agentContinueDisabled", () => {
  it("holds Continue in the redesign only while agent states load", () => {
    expect(
      agentContinueDisabled({
        redesign: true,
        agentReady: false,
        statesLoading: true,
      }),
    ).toBe(true);
    expect(
      agentContinueDisabled({
        redesign: true,
        agentReady: false,
        statesLoading: false,
      }),
    ).toBe(false);
  });

  it("keeps today's guide blocked until an agent is ready", () => {
    expect(
      agentContinueDisabled({
        redesign: false,
        agentReady: false,
        statesLoading: false,
      }),
    ).toBe(true);
    expect(
      agentContinueDisabled({
        redesign: false,
        agentReady: true,
        statesLoading: true,
      }),
    ).toBe(false);
  });
});

describe("devicesShowMachines", () => {
  it("offers other machines only once bb connect is on", () => {
    expect(devicesShowMachines({ status: "on", url: "https://x" })).toBe(true);
    expect(devicesShowMachines({ status: "off" })).toBe(false);
    expect(devicesShowMachines({ status: "unavailable" })).toBe(false);
  });
});

describe("signInSiteName", () => {
  it("returns null when the URL has no usable host", () => {
    expect(signInSiteName("not a url")).toBeNull();
    expect(signInSiteName("file:///tmp/sign-in")).toBeNull();
  });
});

describe("agentSignInView", () => {
  const DEVICE_OUTPUT =
    "Open https://auth.example.com/device and enter code ABCD-1234\r\n";

  it("opens the terminal without a parsed link for other agents once it prints", () => {
    const base = {
      parsed: false,
      connect: false,
      fallbackDue: false,
      terminalChoice: null,
      signInLink: "last" as const,
    };
    expect(agentSignInView({ ...base, outputText: null })).toEqual({
      guide: null,
      terminalVisible: true,
      started: false,
    });
    expect(agentSignInView({ ...base, outputText: "" }).started).toBe(false);
    expect(agentSignInView({ ...base, outputText: DEVICE_OUTPUT })).toEqual({
      guide: null,
      terminalVisible: true,
      started: true,
    });
    expect(
      agentSignInView({
        ...base,
        outputText: DEVICE_OUTPUT,
        terminalChoice: false,
      }).terminalVisible,
    ).toBe(false);
  });

  it("keeps Pi's terminal panel open from the start", () => {
    expect(
      agentSignInView({
        parsed: false,
        connect: true,
        outputText: null,
        fallbackDue: false,
        terminalChoice: null,
        signInLink: "last",
      }),
    ).toEqual({ guide: null, terminalVisible: true, started: true });
  });

  it("lifts the link and code out of a parsed agent's output with the terminal hidden", () => {
    expect(
      agentSignInView({
        parsed: true,
        connect: false,
        outputText: DEVICE_OUTPUT,
        fallbackDue: false,
        terminalChoice: null,
        signInLink: "last",
      }),
    ).toEqual({
      guide: parseSignInOutput(DEVICE_OUTPUT, "last"),
      terminalVisible: false,
      started: true,
    });
    expect(parseSignInOutput(DEVICE_OUTPUT, "last").url).not.toBeNull();
  });
});

describe("signInBrowserIsOnMachine", () => {
  it.each([
    {
      viewer: "the desktop app",
      hostname: "brsbl.getbb.app",
      isDesktop: true,
      agentOnLocalDaemonHost: true,
      browser: true,
    },
    {
      viewer: "a loopback browser",
      hostname: "localhost",
      isDesktop: false,
      agentOnLocalDaemonHost: true,
      browser: true,
    },
    {
      viewer: "a getbb.app share",
      hostname: "brsbl-bbox--41201.getbb.app",
      isDesktop: false,
      agentOnLocalDaemonHost: true,
      browser: false,
    },
    {
      viewer: "the desktop app with the agent on another machine",
      hostname: "localhost",
      isDesktop: true,
      agentOnLocalDaemonHost: false,
      browser: false,
    },
  ])(
    "signs in with a browser link from $viewer only when browser is $browser",
    ({ hostname, isDesktop, agentOnLocalDaemonHost, browser }) => {
      expect(
        signInBrowserIsOnMachine({
          agentOnLocalDaemonHost,
          hostname,
          isDesktop,
        }),
      ).toBe(browser);
    },
  );
});
