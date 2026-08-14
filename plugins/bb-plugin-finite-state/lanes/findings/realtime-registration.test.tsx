// @vitest-environment jsdom

import { resolve } from "node:path";

import { cleanup, configure, waitFor } from "@testing-library/react";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createPluginContext } from "../../lib/context.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { connectedRemoteStatus } from "../../test/app-connections.js";
import { registerPlatformHandlers } from "../../test/mock-remote/platform/register.js";
import { createMockPlatformState } from "../../test/mock-remote/platform/state.js";
import { createMockRemote } from "../../test/mock-remote/server.js";
import { registerSync } from "../sync/register.js";
import { registerFindings } from "./register.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../test/mock-remote/fixtures",
);

class FindingsResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1200, 600),
            borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
          },
        ],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

function requiredId(
  row: Record<string, unknown> | undefined,
  label: string,
): string {
  const id = row?.["id"];
  if (typeof id !== "string" || id.length === 0)
    throw new Error(`${label} has no id`);
  return id;
}

beforeAll(() => {
  configure({ asyncUtilTimeout: 30_000 });
  vi.stubGlobal("ResizeObserver", FindingsResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
});

afterEach(() => cleanup());

describe("registered findings realtime boundary", () => {
  it(
    "auto-selects and populates a cold panel after the real sync publisher accepts the first finding generation",
    { timeout: 60_000 },
    async () => {
      const host = createFakePluginHost({
        pluginId: "finite-state-findings-realtime",
        sdk: {
          projects: {
            get: ({ projectId }) => ({
              id: projectId,
              sources: [
                {
                  id: "source-1",
                  projectId,
                  type: "local_path" as const,
                  hostId: "host-1",
                  path: "/workspace",
                  isDefault: true,
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            }),
          },
        },
      });
      const state = createMockPlatformState(FIXTURE_ROOT);
      const mock = createMockRemote({
        platformToken: "fs140-token",
        assuranceStudioKey: "unused",
        fixtureRoot: FIXTURE_ROOT,
        register(service, registry) {
          if (service === "platform") registerPlatformHandlers(registry, state);
        },
      });
      const platform = new PlatformClient({
        baseUrl: "http://platform.mock",
        token: "fs140-token",
        fetch: mock.platform.fetch,
      });
      const assuranceStudio = new AssuranceStudioClient({
        baseUrl: "http://assurance-studio.mock",
        apiKey: "unused",
        fetch: mock.assuranceStudio.fetch,
      });

      try {
        const ctx = createPluginContext(host.bb);
        const services: RemoteServices = {
          platform,
          assuranceStudio,
          forgeCompute: null,
        };
        ctx.service<RemoteServices>("remote-services", () => services);
        registerSync(host.bb, ctx);
        registerFindings(host.bb, ctx);

        const platformProjectId = requiredId(
          [...state.projects.values()][0],
          "project fixture",
        );
        const projectVersionId = requiredId(
          [...state.versions.values()].find(
            (version) => version["priorVersionId"] !== null,
          ),
          "successor version fixture",
        );
        const app = await loadPluginApp(() => import("../../app.js"));
        const panel = app.navPanels.find(
          (candidate) => candidate.path === "findings",
        );
        if (!panel) throw new Error("Findings panel not registered");
        let versionReads = 0;
        const slot = renderSlot(
          panel,
          { subPath: "" },
          {
            context: { projectId: "bb-project-fs140" },
            sidebarThreads: {
              status: "ready",
              projects: [
                { id: "bb-project-fs140", name: "FS-140", isPersonal: false },
              ],
            },
            rpc: {
              connectionsStatus: connectedRemoteStatus,
              cachedProjectVersions: (input) => {
                versionReads += 1;
                return host.harness.behavior.callRpc(
                  "cachedProjectVersions",
                  input,
                );
              },
              findingsSavedViewsGet: () => ({
                views: [],
                sha256: null,
                recoveredFromCorrupt: false,
              }),
              findingsUiList: (input) =>
                host.harness.behavior.callRpc("findingsUiList", input),
            },
          },
        );

        expect(await slot.findByText("Choose a findings scope")).toBeTruthy();
        expect(versionReads).toBe(1);
        const signalCursor = host.harness.inspection.realtimeSignals.length;
        await host.harness.behavior.callRpc("syncPull", {
          workspaceProjectId: "bb-project-fs140",
          projectId: platformProjectId,
          projectVersionId,
          kinds: ["finding"],
        });
        const published = host.harness.inspection.realtimeSignals
          .slice(signalCursor)
          .filter((signal) => signal.channel === "findings:changed");
        expect(published).toEqual([
          {
            channel: "findings:changed",
            payload: { projectId: platformProjectId, projectVersionId },
          },
        ]);
        for (const signal of published)
          await slot.behavior.emitRealtime(signal.channel, signal.payload);

        await waitFor(() => expect(versionReads).toBe(2));
        await waitFor(() => expect(slot.getByRole("grid")).toBeTruthy(), {
          timeout: 30_000,
        });
        expect(
          (slot.getByLabelText("Findings project version") as HTMLSelectElement)
            .value,
        ).toBe(`${platformProjectId}/${projectVersionId}`);
        expect(slot.queryByText("Choose a findings scope")).toBeNull();
      } finally {
        platform.close();
        assuranceStudio.close();
        await mock.close();
        await host.harness.lifecycle.dispose();
      }
    },
  );
});
