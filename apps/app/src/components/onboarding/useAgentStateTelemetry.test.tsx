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
  it("reports each shipped agent's status, maps nothing for custom agents, and fires once per distinct state", () => {
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
          agent_status_claude_code: "unauthenticated",
          agent_status_codex: "not_installed",
          agent_status_acp_hermes_agent: "unsupported_version",
        },
      },
      {
        name: "onboarding_agent_state",
        properties: {
          entry: "first_run",
          agent_installed: true,
          agent_ready: true,
          agent_status_claude_code: "ready",
          agent_status_codex: "not_installed",
          agent_status_acp_hermes_agent: "unsupported_version",
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
          agent_status_codex: "unknown",
          agent_status_pi: "expired",
        },
      },
    ]);
  });
});
