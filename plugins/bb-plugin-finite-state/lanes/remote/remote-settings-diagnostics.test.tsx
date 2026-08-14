// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "./connection-state.js";
import type { RemoteSelfDiagnosisView } from "./diagnostics-contract.js";

const app = await loadPluginApp(() => import("../../app.js"));

function diagnosis(
  state: RemoteSelfDiagnosisView["state"],
  message: string,
): RemoteSelfDiagnosisView {
  return {
    state,
    message,
    checkedAt: state === "checking" ? null : "2026-08-14T19:00:00.000Z",
    durationMs: state === "ok" ? 21_000 : null,
  };
}

function settingsSection() {
  const registration = app.settingsSections.find(
    (candidate) => candidate.id === "remote-self-diagnosis",
  );
  if (!registration)
    throw new Error("remote settings section was not registered");
  return registration;
}

afterEach(() => cleanup());

describe("remote settings self-diagnosis", () => {
  it("renders the named bad-credential presentation and fixes in place", async () => {
    let platform = diagnosis(
      "auth-failed",
      "Platform authentication failed with HTTP 401. Refresh Platform token (platformToken).",
    );
    const slot = renderSlot(
      settingsSection(),
      {},
      {
        rpc: {
          remoteConnectionSelfDiagnosis: () => ({
            platform,
            assuranceStudio: diagnosis(
              "ok",
              "Authenticated read succeeded in 21.0s (slow response).",
            ),
          }),
        },
      },
    );

    expect(await slot.findByText("Auth failed")).toBeTruthy();
    expect(
      slot.getByText(/Refresh Platform token \(platformToken\)/u),
    ).toBeTruthy();
    expect(slot.getByText(/slow response/u)).toBeTruthy();

    platform = diagnosis("ok", "Authenticated read succeeded in 18ms.");
    await slot.behavior.emitRealtime(REMOTE_CONNECTIONS_CHANGED_CHANNEL, null);

    expect(await slot.findAllByText("OK")).toHaveLength(2);
    expect(slot.queryByText("Auth failed")).toBeNull();
  });

  it("renders base-URL shape failures separately from credentials and network", async () => {
    const slot = renderSlot(
      settingsSection(),
      {},
      {
        rpc: {
          remoteConnectionSelfDiagnosis: () => ({
            platform: diagnosis(
              "invalid-settings",
              "Platform URL (platformBaseUrl) must end with /api because Platform routes omit that prefix.",
            ),
            assuranceStudio: diagnosis(
              "invalid-settings",
              "Assurance Studio URL (asBaseUrl) must not end with /api because Assurance Studio routes already include that prefix.",
            ),
          }),
        },
      },
    );

    expect(await slot.findAllByText("Invalid settings")).toHaveLength(2);
    expect(slot.getByText(/platformBaseUrl.*end with \/api/u)).toBeTruthy();
    expect(slot.getByText(/asBaseUrl.*must not end with \/api/u)).toBeTruthy();
    expect(slot.queryByText("Auth failed")).toBeNull();
    expect(slot.queryByText("Unreachable")).toBeNull();
  });

  it("keeps timeout distinct from network unreachability", async () => {
    const slot = renderSlot(
      settingsSection(),
      {},
      {
        rpc: {
          remoteConnectionSelfDiagnosis: () => ({
            platform: diagnosis(
              "timed-out",
              "Platform timed out after its 30s assertion budget.",
            ),
            assuranceStudio: diagnosis(
              "unreachable",
              "Assurance Studio could not be reached. Check DNS, proxy, and network connectivity.",
            ),
          }),
        },
      },
    );

    expect(await slot.findByText("Timed out")).toBeTruthy();
    expect(slot.getByText("Unreachable")).toBeTruthy();
  });
});
