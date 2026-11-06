// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import type { SystemProviderState } from "@bb/server-contract";
import { resolveAgentSetupState } from "./onboarding-model";
import { useRefetchOnUpdateNeeded } from "./useRefetchOnUpdateNeeded";

function codexHealth(
  status: SystemProviderState["status"],
): SystemProviderState {
  return {
    providerId: "codex",
    displayName: "Codex",
    status,
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: status === "ready" ? "0.166.0" : "0.130.0",
    minimumSupportedVersion: "0.136.0",
    canInstall: true,
    canUpdate: true,
    loginCommand: "codex login",
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  };
}

function codexCli(outdated: boolean): ProviderCliStatus {
  return {
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/bin/codex",
    installed: true,
    installSource: "npmGlobal",
    currentVersion: outdated ? "0.130.0" : "0.166.0",
    latestVersion: "0.166.0",
    minimumSupportedVersion: "0.136.0",
    npmPackageName: "@openai/codex",
    npmGlobalPackageVersion: outdated ? "0.130.0" : "0.166.0",
    installAction: outdated
      ? {
          kind: "update",
          label: "Update",
          command: "npm install -g @openai/codex@latest",
        }
      : null,
    needsUpdate: outdated,
    versionUnsupported: outdated,
  };
}

describe("useRefetchOnUpdateNeeded", () => {
  it("offers Update once a ready agent turns out of date, without a reload", async () => {
    const cliResponses = [false, false, true];
    const fetchCli = vi.fn(async () => ({
      codex: codexCli(cliResponses.shift() ?? true),
    }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({
        health,
        polledAt,
      }: {
        health: SystemProviderState;
        polledAt: number;
      }) => {
        const cli = useQuery({
          queryKey: ["provider-cli-status"],
          queryFn: fetchCli,
          staleTime: Infinity,
        });
        const { refetch } = cli;
        useRefetchOnUpdateNeeded({
          enabled: true,
          states: [health],
          statesUpdatedAt: polledAt,
          cliStatus: cli.data,
          refetch: () => void refetch({ cancelRefetch: false }),
        });
        return resolveAgentSetupState({
          health,
          cliStatus: cli.data?.codex,
          installing: false,
          installFailure: null,
          signingIn: false,
          signInFailed: false,
          installInfoPending: cli.isPending,
          whileInstallInfoPending: "offerInstall",
        });
      },
      {
        wrapper,
        initialProps: { health: codexHealth("ready"), polledAt: 1 },
      },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ health: codexHealth("ready"), polledAt: 2 });
    expect(fetchCli).toHaveBeenCalledTimes(1);

    rerender({ health: codexHealth("unsupported_version"), polledAt: 3 });
    await waitFor(() => expect(fetchCli).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({
      status: "update",
      canInstall: false,
    });

    rerender({ health: codexHealth("unsupported_version"), polledAt: 4 });
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "update",
        detail: "Needs version 0.136.0 or newer",
        canInstall: true,
      }),
    );
    expect(fetchCli).toHaveBeenCalledTimes(3);

    rerender({ health: codexHealth("unsupported_version"), polledAt: 5 });
    expect(fetchCli).toHaveBeenCalledTimes(3);
    client.clear();
  });

  it("leaves today's guide as on main: no extra install-info refetch", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ polledAt }: { polledAt: number }) =>
        useRefetchOnUpdateNeeded({
          enabled: false,
          states: [codexHealth("unsupported_version")],
          statesUpdatedAt: polledAt,
          cliStatus: { codex: codexCli(false) },
          refetch,
        }),
      { initialProps: { polledAt: 1 } },
    );
    rerender({ polledAt: 2 });

    expect(refetch).not.toHaveBeenCalled();
  });
});
