// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/plugin-sdk-hooks", () => ({
  callPluginRpc: vi.fn(),
}));

import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  composeModelForProvider,
  LocalModelsSubsection,
  VoiceInputSettingsSectionContent,
  type VoiceTranscriptionStatus,
} from "./VoiceInputSettingsSection";

const mockRpc = vi.mocked(callPluginRpc);

const devices = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

const transcription: VoiceTranscriptionStatus = {
  model: "codex/gpt-transcribe",
  enabled: true,
  ceilingBytes: 25 * 1024 * 1024,
  timeoutMaxMs: 300_000,
  recordingBitrate: 32_000,
  voiceServices: [
    {
      id: "codex",
      displayName: "Codex (ChatGPT account or API key)",
      pluginId: "provider-codex",
    },
    {
      id: "local",
      displayName: "Local",
      pluginId: "local-transcribe",
    },
  ],
};

function renderContent(
  overrides: Partial<
    Parameters<typeof VoiceInputSettingsSectionContent>[0]
  > = {},
) {
  const onUpdateTranscription = vi.fn();
  render(
    <TooltipProvider>
      <VoiceInputSettingsSectionContent
        devices={devices}
        errorMessage={null}
        isLoading={false}
        isSupported={true}
        onDeviceChange={() => undefined}
        onRefresh={() => undefined}
        preferredDeviceId={null}
        transcription={transcription}
        onUpdateTranscription={onUpdateTranscription}
        localModelsSlot={<div>local-models-slot</div>}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return onUpdateTranscription;
}

function expandAdvanced(): void {
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
}

function openDropdown(label: string): void {
  fireEvent.pointerDown(screen.getByLabelText(label), { button: 0 });
}

async function chooseOption(optionLabel: string): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole("menuitem", { name: optionLabel })).toBeDefined(),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: optionLabel }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("composeModelForProvider", () => {
  it("keeps the current model when the provider is unchanged", () => {
    expect(composeModelForProvider("codex", "codex/gpt-4o-mini-transcribe")).toBe(
      "codex/gpt-4o-mini-transcribe",
    );
  });

  it("uses the Codex default model when switching to Codex", () => {
    expect(composeModelForProvider("codex", "local/parakeet-v2")).toBe(
      "codex/gpt-transcribe",
    );
  });

  it("always sets local/parakeet-v2 for the Local provider", () => {
    expect(composeModelForProvider("local", "codex/gpt-transcribe")).toBe(
      "local/parakeet-v2",
    );
  });

  it("leaves unknown providers untouched", () => {
    expect(composeModelForProvider("openai", "openai/whisper-1")).toBe(
      "openai/whisper-1",
    );
  });

  it("carries the model id across to a third provider", () => {
    expect(composeModelForProvider("acme", "openai/whisper-1")).toBe(
      "acme/whisper-1",
    );
  });

  it("returns null when no valid model string can be composed", () => {
    expect(composeModelForProvider("acme", "openai")).toBeNull();
    expect(composeModelForProvider("acme", "")).toBeNull();
  });
});

describe("VoiceInputSettingsSectionContent", () => {
  it("offers Codex and Local with no model textbox and no Active badge", async () => {
    renderContent();
    expect(
      (screen.getByLabelText("Transcription provider") as HTMLElement)
        .textContent,
    ).toContain("Codex");
    expect(screen.queryByLabelText("Transcription model id")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();

    openDropdown("Transcription provider");
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: "Codex (ChatGPT account or API key)",
        }),
      ).toBeDefined(),
    );
    expect(screen.getByRole("menuitem", { name: "Local" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "OpenAI" })).toBeNull();
  });

  it("offers only registered services, not a hardcoded universe", async () => {
    cleanup();
    renderContent({
      transcription: {
        ...transcription,
        voiceServices: [transcription.voiceServices[0]],
      },
    });
    openDropdown("Transcription provider");
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: "Codex (ChatGPT account or API key)",
        }),
      ).toBeDefined(),
    );
    expect(screen.queryByRole("menuitem", { name: "Local" })).toBeNull();
  });

  it("switching provider commits the composed model string", async () => {
    const onUpdate = renderContent();
    openDropdown("Transcription provider");
    await chooseOption("Local");
    expect(onUpdate).toHaveBeenCalledWith({
      transcriptionModel: "local/parakeet-v2",
    });
  });

  it("does not show per-service cap ledger rows", () => {
    renderContent();
    expect(screen.queryByText("Service audio limits")).toBeNull();
    expect(screen.queryByText(/effective/i)).toBeNull();
  });

  it("keeps advanced controls collapsed until expanded", () => {
    renderContent();
    expect(screen.queryByLabelText("Recording limit")).toBeNull();

    expandAdvanced();

    expect(screen.getByLabelText("Recording limit")).toBeDefined();
    expect(
      screen.getByText(/How large a recording can be/),
    ).toBeDefined();
  });

  it("commits a recording limit from the dropdown", async () => {
    const onUpdate = renderContent();
    expandAdvanced();
    openDropdown("Recording limit");
    await chooseOption("10 MB");
    expect(onUpdate).toHaveBeenCalledWith({
      transcriptionMaxBytes: 10 * 1024 * 1024,
    });
  });

  it("commits a recording quality from the dropdown with a minutes hint", async () => {
    const onUpdate = renderContent();
    expandAdvanced();
    expect(screen.getByText(/About 109 minutes/)).toBeDefined();
    openDropdown("Recording quality");
    await chooseOption("64 kbps");
    expect(onUpdate).toHaveBeenCalledWith({ recordingBitrate: 64_000 });
  });

  it("keeps the timeout input with plain-language copy", () => {
    renderContent();
    expandAdvanced();
    expect(
      screen.getByText(/does not respond by that time/),
    ).toBeDefined();
    expect(
      (screen.getByLabelText("Transcription timeout in seconds") as HTMLInputElement)
        .value,
    ).toBe("300");
  });

  it("renders the local-models slot only when the provider is Local", () => {
    renderContent();
    expect(screen.queryByText("local-models-slot")).toBeNull();

    cleanup();
    renderContent({
      transcription: { ...transcription, model: "local/parakeet-v2" },
    });
    expect(screen.getByText("local-models-slot")).toBeDefined();
  });
});

describe("LocalModelsSubsection", () => {
  function renderSubsection(pluginId: string | null) {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <TooltipProvider>
        <LocalModelsSubsection pluginId={pluginId} />
      </TooltipProvider>,
      { wrapper },
    );
  }

  it("shows the plugin-missing fallback when no local plugin is installed", () => {
    renderSubsection(null);
    expect(screen.getByText(/local-transcribe plugin/)).toBeDefined();
    expect(screen.getByText(/isn't installed/)).toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("shows the plugin error fallback when the RPC fails", async () => {
    mockRpc.mockRejectedValue(new Error("plugin offline"));
    renderSubsection("local-stt");
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load local models/)).toBeDefined(),
    );
  });

  it("shows an empty state when no models are downloadable", async () => {
    mockRpc.mockResolvedValue({ models: [] });
    renderSubsection("local-stt");
    await waitFor(() =>
      expect(
        screen.getByText("No local models are available to download yet."),
      ).toBeDefined(),
    );
  });

  it("renders state-driven actions for each model", async () => {
    mockRpc.mockResolvedValue({
      models: [
        {
          id: "parakeet-v2",
          displayName: "Parakeet v2 English",
          state: "missing",
          infoUrl: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2",
        },
        { id: "ready-one", displayName: "Ready One", state: "ready" },
        {
          id: "busy-one",
          displayName: "Busy One",
          state: "downloading",
          progressPercent: 42,
        },
        { id: "weird", displayName: "Weird One", state: "verifying" },
      ],
    });
    renderSubsection("local-stt");

    await waitFor(() =>
      expect(screen.getByText("Parakeet v2 English")).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Use" })).toBeDefined();
    expect(screen.getByText("42%")).toBeDefined();
    expect(screen.getByText("verifying")).toBeDefined();
    expect(screen.getByText("1/4 downloaded")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Open model card on Hugging Face" }),
    ).toBeDefined();
  });

  it("marks the active model with a check and selects another on Use", async () => {
    mockRpc.mockResolvedValue({
      models: [
        { id: "parakeet-v2", displayName: "Parakeet v2", state: "ready" },
        { id: "parakeet-v3", displayName: "Parakeet v3", state: "ready" },
      ],
    });
    const onSelectModel = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <TooltipProvider>
        <LocalModelsSubsection
          pluginId="local-stt"
          activeModelId="parakeet-v2"
          onSelectModel={onSelectModel}
        />
      </TooltipProvider>,
      { wrapper },
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Selected model")).toBeDefined(),
    );
    expect(screen.queryByText("In use")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onSelectModel).toHaveBeenCalledWith("parakeet-v3");
  });

  it("starts a download via models_setup on click", async () => {
    mockRpc.mockImplementation(async (_fetch, _pluginId, method) => {
      if (method === "models_setup") {
        return { started: true };
      }
      return {
        models: [
          { id: "parakeet-v2", displayName: "Parakeet v2", state: "missing" },
        ],
      };
    });
    renderSubsection("local-stt");

    const button = await screen.findByRole("button", { name: "Download" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        expect.anything(),
        "local-stt",
        "models_setup",
        { id: "parakeet-v2" },
      ),
    );
  });

  it("deletes a downloaded model via models_remove", async () => {
    mockRpc.mockImplementation(async (_fetch, _pluginId, method) => {
      if (method === "models_remove") {
        return { removed: true };
      }
      return {
        models: [
          { id: "parakeet-v2", displayName: "Parakeet v2", state: "ready" },
        ],
      };
    });
    const { wrapper } = createQueryClientTestHarness();
    render(
      <TooltipProvider>
        <LocalModelsSubsection pluginId="local-stt" />
      </TooltipProvider>,
      { wrapper },
    );

    const button = await screen.findByRole("button", { name: "Delete Parakeet v2" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        expect.anything(),
        "local-stt",
        "models_remove",
        { id: "parakeet-v2" },
      ),
    );
  });

  it("surfaces a failed download with its error and a retry action", async () => {
    mockRpc.mockImplementation(async (_fetch, _pluginId, method) => {
      if (method === "models_setup") {
        return { started: true };
      }
      return {
        models: [
          {
            id: "parakeet-v2",
            displayName: "Parakeet v2 English",
            state: "failed",
            error: "download failed (500)",
          },
        ],
      };
    });
    renderSubsection("local-stt");

    await waitFor(() =>
      expect(screen.getByText("download failed (500)")).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        expect.anything(),
        "local-stt",
        "models_setup",
        { id: "parakeet-v2" },
      ),
    );
  });
});
