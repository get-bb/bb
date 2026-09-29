// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComponentProps } from "react";
import type { ProductMap } from "./src/product-map";

vi.mock("./src/product-map", () => ({
  ProductMap: (props: ComponentProps<typeof ProductMap>) => (
    <>
      {["GitHub", "Tasks"].map((name) => (
        <a key={name} href={props.pluginPageHref?.(name) ?? undefined}>
          {name}
          {props.renderPluginIcon?.(name)}
        </a>
      ))}
    </>
  ),
}));
vi.mock("@/components/ui/plugin-icon", () => ({
  PluginBrandIcon: (props: { iconUrl: string | null }) => (
    <span>{props.iconUrl}</span>
  ),
}));
const catalogEntry = {
  displayName: "Plugin",
  description: "",
  icon: null,
  iconUrl: null,
  iconTinted: false,
  screenshots: [],
  collections: [],
  source: "builtin",
  repositoryUrl: null,
  marketplace: "official",
  marketplaceDisplayName: "Official",
  publisherKey: "bb",
  publisherLabel: "BB",
  official: true,
  author: null,
  installed: false,
  installs: null,
  compatible: true,
  incompatibleReason: null,
};
const app = await loadPluginApp(() => import("./app"));
afterEach(cleanup);

it("uses installed artwork over catalog artwork and keeps catalog links if the installed read fails", async () => {
  let offline = false;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      sdk: {
        plugins: {
          list: async () => {
            if (offline) throw new Error("offline");
            return {
              plugins: [
                {
                  id: "github",
                  icon: null,
                  iconUrl: "/installed.svg",
                  source: "builtin:github",
                  rootDir: "/github",
                  version: "1",
                  provenance: "builtin",
                  isOrphanedBuiltin: false,
                  publisherLabel: null,
                  sourceDisplay: "builtin",
                  updateState: {},
                  enabled: true,
                  description: null,
                  name: "GitHub",
                  screenshots: [],
                  collections: [],
                  status: "running",
                  statusDetail: null,
                  handlerStats: {
                    count: 0,
                    totalMs: 0,
                    maxMs: 0,
                    errorCount: 0,
                  },
                  services: [],
                  schedules: [],
                  cliCommand: null,
                  capabilities: [],
                  hasSettings: false,
                  app: { hasApp: false, bundle: null },
                  logoUrl: null,
                  logoDarkUrl: null,
                  providerIds: [],
                  icons: {},
                },
              ],
            };
          },
          catalog: {
            search: async () => ({
              results: [
                {
                  ...catalogEntry,
                  entryId: "github",
                  pluginId: "github",
                  iconUrl: "/catalog.svg",
                },
                {
                  ...catalogEntry,
                  entryId: "tasks",
                  pluginId: "tasks",
                  iconTinted: true,
                },
              ],
              collections: [],
            }),
          },
        },
      },
    },
  );
  await waitFor(() => expect(slot.getByText("/installed.svg")).toBeTruthy());
  expect(slot.queryByText("/catalog.svg")).toBeNull();
  expect(slot.getByText("Tasks").getAttribute("href")).toBe("/plugins/tasks");
  offline = true;
  await slot.setRealtimeConnectionState("reconnecting");
  await slot.setRealtimeConnectionState("connected");
  await waitFor(() => expect(slot.getByText("/installed.svg")).toBeTruthy());
  expect(slot.getByText("Tasks").getAttribute("href")).toBe("/plugins/tasks");
});
