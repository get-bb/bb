// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import type { SystemProviderState } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useAgentStateTelemetry } from "./useAgentStateTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function state(
  providerId: string,
  status: SystemProviderState["status"],
): SystemProviderState {
  return {
    providerId,
    displayName: providerId,
    status,
    statusMessage: null,
    accountEmail: "person@example.com",
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: true,
    canUpdate: true,
    loginCommand: null,
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  };
}

interface Props {
  states: readonly SystemProviderState[] | undefined;
  isError: boolean;
}

function renderTelemetry(initialProps: Props) {
  return renderHook(
    ({ states, isError }: Props) =>
      useAgentStateTelemetry({ entry: "first_run", states, isError }),
    { initialProps },
  );
}

function recorded() {
  return vi.mocked(recordTelemetryEvent).mock.calls.map(([event]) => event);
}

describe("agent state telemetry", () => {
  it("reports each agent's status once per distinct set of states", () => {
    const signedOut = [
      state("claude-code", "unauthenticated"),
      state("codex", "not_installed"),
      state("acp-hermes-agent", "unsupported_version"),
      state("acp-my-private-agent", "ready"),
    ];
    const view = renderTelemetry({ states: undefined, isError: false });
    view.rerender({ states: signedOut, isError: false });
    view.rerender({ states: [...signedOut].reverse(), isError: false });
    view.rerender({
      states: [state("claude-code", "ready"), ...signedOut.slice(1)],
      isError: false,
    });

    expect(recorded()).toEqual([
      {
        name: "onboarding_agent_state",
        properties: {
          entry: "first_run",
          agent_installed: true,
          agent_ready: true,
          agent_statuses: {
            "acp-hermes-agent": "unsupported_version",
            "acp-my-private-agent": "ready",
            "claude-code": "unauthenticated",
            codex: "not_installed",
          },
        },
      },
      {
        name: "onboarding_agent_state",
        properties: {
          entry: "first_run",
          agent_installed: true,
          agent_ready: true,
          agent_statuses: {
            "acp-hermes-agent": "unsupported_version",
            "acp-my-private-agent": "ready",
            "claude-code": "ready",
            codex: "not_installed",
          },
        },
      },
    ]);
  });

  it("omits per-agent statuses when the agent states fail to load", () => {
    renderTelemetry({
      states: [state("claude-code", "ready")],
      isError: true,
    });

    expect(recorded()).toEqual([
      {
        name: "onboarding_agent_state",
        properties: {
          entry: "first_run",
          agent_installed: null,
          agent_ready: null,
        },
      },
    ]);
  });

  it("reports unknown statuses without claiming the agent is missing", () => {
    renderTelemetry({
      states: [state("codex", "unknown"), state("pi", "expired")],
      isError: false,
    });

    expect(recorded()).toEqual([
      {
        name: "onboarding_agent_state",
        properties: {
          entry: "first_run",
          agent_installed: true,
          agent_ready: null,
          agent_statuses: { codex: "unknown", pi: "expired" },
        },
      },
    ]);
  });
});
