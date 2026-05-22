// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localProviderCliStatusQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { ProviderCliHealthToasts } from "./ProviderCliHealthToasts";

interface ToastButton {
  label: string;
  onClick: () => void;
}

interface ProviderCliWarningToastOptions {
  id: string;
  description: string;
  duration: number;
  closeButton: boolean;
  action?: ToastButton;
  cancel?: ToastButton;
  onDismiss?: () => void;
}

interface ProviderCliToastInvocation {
  title: string;
  options: ProviderCliWarningToastOptions;
}

interface ProviderCliHealthFetchState {
  hostDaemonPort: number;
  status: ProviderCliStatusResponse;
}

interface ProviderCliHealthRenderResult {
  queryClient: QueryClient;
  state: ProviderCliHealthFetchState;
}

const providerCliToastState = vi.hoisted(() => {
  const invocations: ProviderCliToastInvocation[] = [];
  const activeToasts = new Map<string, ProviderCliWarningToastOptions>();
  const warning = vi.fn(
    (title: string, options: ProviderCliWarningToastOptions) => {
      invocations.push({ title, options });
      activeToasts.set(options.id, options);
    },
  );
  const dismiss = vi.fn((toastId: string | number | undefined) => {
    if (typeof toastId !== "string") {
      return;
    }
    const options = activeToasts.get(toastId);
    activeToasts.delete(toastId);
    options?.onDismiss?.();
  });
  return {
    activeToasts,
    dismiss,
    error: vi.fn(),
    invocations,
    success: vi.fn(),
    warning,
  };
});

vi.mock("sonner", () => ({
  toast: {
    dismiss: providerCliToastState.dismiss,
    error: providerCliToastState.error,
    success: providerCliToastState.success,
    warning: providerCliToastState.warning,
  },
}));

const HOST_DAEMON_PORT = 4123;
const CODEX_TOAST_ID = "provider-cli-health:codex";
const CODEX_MISSING_FINGERPRINT = "codex:missing:0.133.0";
const DISMISSED_STORAGE_KEY_PREFIX = "bb:provider-cli-toast:dismissed-v2:";
const CODEX_DISMISSED_STORAGE_KEY = `${DISMISSED_STORAGE_KEY_PREFIX}${CODEX_MISSING_FINGERPRINT}`;

function codexMissingStatus(): ProviderCliStatus {
  return {
    currentVersion: null,
    displayName: "Codex",
    executableName: "codex",
    executablePath: null,
    installAction: {
      command: "npm install -g @openai/codex",
      commandKind: "exec",
      kind: "install",
      label: "Install",
    },
    installed: false,
    installSource: "notInstalled",
    latestVersion: "0.133.0",
    needsUpdate: false,
    npmGlobalPackageVersion: null,
    npmPackageName: "@openai/codex",
  };
}

function codexInstalledStatus(): ProviderCliStatus {
  return {
    currentVersion: "0.133.0",
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installAction: null,
    installed: true,
    installSource: "npmGlobal",
    latestVersion: "0.133.0",
    needsUpdate: false,
    npmGlobalPackageVersion: "0.133.0",
    npmPackageName: "@openai/codex",
  };
}

function claudeCodeInstalledStatus(): ProviderCliStatus {
  return {
    currentVersion: "1.0.0",
    displayName: "Claude Code",
    executableName: "claude",
    executablePath: "/usr/local/bin/claude",
    installAction: null,
    installed: true,
    installSource: "npmGlobal",
    latestVersion: "1.0.0",
    needsUpdate: false,
    npmGlobalPackageVersion: "1.0.0",
    npmPackageName: "@anthropic-ai/claude-code",
  };
}

function statusResponseWithCodex(
  codex: ProviderCliStatus,
): ProviderCliStatusResponse {
  return {
    claudeCode: claudeCodeInstalledStatus(),
    codex,
  };
}

function installProviderCliHealthFetchRoutes(
  state: ProviderCliHealthFetchState,
): void {
  installFetchRoutes([
    {
      pathname: "/api/v1/system/config",
      handler: async () =>
        jsonResponse({
          hostDaemonPort: state.hostDaemonPort,
          voiceTranscriptionEnabled: false,
        }),
    },
    {
      pathname: "/provider-clis/status",
      port: state.hostDaemonPort,
      handler: async () => jsonResponse(state.status),
    },
  ]);
}

function renderProviderCliHealthToasts(
  initialStatus: ProviderCliStatusResponse,
): ProviderCliHealthRenderResult {
  const state: ProviderCliHealthFetchState = {
    hostDaemonPort: HOST_DAEMON_PORT,
    status: initialStatus,
  };
  installProviderCliHealthFetchRoutes(state);

  const { queryClient, wrapper } = createQueryClientTestHarness();
  render(<ProviderCliHealthToasts />, { wrapper });

  return { queryClient, state };
}

function resetProviderCliToastState(): void {
  providerCliToastState.activeToasts.clear();
  providerCliToastState.invocations.splice(0);
  providerCliToastState.dismiss.mockClear();
  providerCliToastState.error.mockClear();
  providerCliToastState.success.mockClear();
  providerCliToastState.warning.mockClear();
}

function requireLatestCodexToastInvocation(): ProviderCliToastInvocation {
  for (
    let index = providerCliToastState.invocations.length - 1;
    index >= 0;
    index -= 1
  ) {
    const invocation = providerCliToastState.invocations[index];
    if (invocation.options.id === CODEX_TOAST_ID) {
      return invocation;
    }
  }
  throw new Error("Expected a Codex provider CLI toast invocation.");
}

async function waitForVisibleCodexToast(): Promise<ProviderCliToastInvocation> {
  await waitFor(() => {
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(true);
  });
  return requireLatestCodexToastInvocation();
}

function clickToastCancel(invocation: ProviderCliToastInvocation): void {
  const cancel = invocation.options.cancel;
  if (!cancel) {
    throw new Error("Expected provider CLI toast to have a cancel action.");
  }
  cancel.onClick();
}

async function refetchProviderCliStatus(
  result: ProviderCliHealthRenderResult,
): Promise<void> {
  await act(async () => {
    await result.queryClient.refetchQueries({
      queryKey: localProviderCliStatusQueryKey(result.state.hostDaemonPort),
    });
  });
}

afterEach(() => {
  cleanup();
  resetProviderCliToastState();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ProviderCliHealthToasts", () => {
  it("does not persist dismissal when the toast closes without the cancel button", async () => {
    renderProviderCliHealthToasts(statusResponseWithCodex(codexMissingStatus()));

    const invocation = await waitForVisibleCodexToast();

    act(() => {
      providerCliToastState.dismiss(invocation.options.id);
    });

    expect(window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY)).toBeNull();
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("persists dismissal when the user clicks the cancel button", async () => {
    renderProviderCliHealthToasts(statusResponseWithCodex(codexMissingStatus()));

    const invocation = await waitForVisibleCodexToast();

    act(() => {
      clickToastCancel(invocation);
    });

    expect(window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY)).toBe(
      "true",
    );
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("clears resolved issue state so a recurring missing CLI shows again", async () => {
    const result = renderProviderCliHealthToasts(
      statusResponseWithCodex(codexMissingStatus()),
    );
    await waitForVisibleCodexToast();
    window.localStorage.setItem(CODEX_DISMISSED_STORAGE_KEY, "true");

    result.state.status = statusResponseWithCodex(codexInstalledStatus());
    await refetchProviderCliStatus(result);

    await waitFor(() => {
      expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(
        false,
      );
      expect(
        window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY),
      ).toBeNull();
    });

    const toastInvocationCountAfterResolve =
      providerCliToastState.invocations.length;
    result.state.status = statusResponseWithCodex(codexMissingStatus());
    await refetchProviderCliStatus(result);

    await waitFor(() => {
      expect(providerCliToastState.invocations.length).toBe(
        toastInvocationCountAfterResolve + 1,
      );
      expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(true);
    });
  });
});
