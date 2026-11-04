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
    let outdated = false;
    const fetchCli = vi.fn(async () => ({ codex: codexCli(outdated) }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ health }: { health: SystemProviderState }) => {
        const cli = useQuery({
          queryKey: ["provider-cli-status"],
          queryFn: fetchCli,
          staleTime: Infinity,
        });
        const { refetch } = cli;
        useRefetchOnUpdateNeeded({
          states: [health],
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
        });
      },
      { wrapper, initialProps: { health: codexHealth("ready") } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchCli).toHaveBeenCalledTimes(1);

    outdated = true;
    rerender({ health: codexHealth("unsupported_version") });
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "update",
        detail: "Needs version 0.136.0 or newer",
        canInstall: true,
      }),
    );
    expect(fetchCli).toHaveBeenCalledTimes(2);

    rerender({ health: codexHealth("unsupported_version") });
    expect(fetchCli).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
