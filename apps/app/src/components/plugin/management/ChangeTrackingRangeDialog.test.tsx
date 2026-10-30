// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { PluginDetail } from "@/components/tools/PluginDetail";
import {
  allPluginListQueryKeyPrefix,
  pluginSourceQueryKey,
} from "@/hooks/queries/query-keys";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makePluginListItem } from "@/test/fixtures/plugins";
import {
  ChangeTrackingRangeDialog,
  pluginTrackingSpec,
  trackingRangeCheckSummary,
  type PluginTrackingSpec,
} from "./ChangeTrackingRangeDialog";

const GIT_PLUGIN = makePluginListItem({
  id: "notes",
  name: "Notes",
  source: "git:https://github.com/acme/notes@semver:^0.1.0",
  rootDir: "/cache/notes",
  version: "0.1.0",
  provenance: "catalog",
  catalogEntryId: "notes",
  catalogMarketplaceName: "bb-community",
  sourceDisplay:
    "git · https://github.com/acme/notes · ^0.1.0 · tracks compatible",
});

const installed = {
  version: "a".repeat(40),
  label: "0.1.0",
  display: "https://github.com/acme/notes@v0.1.0 (aaaaaaaaaaaa)",
};

function trackingResult(args: {
  applied: boolean;
  range: string;
  previousRange?: string;
  openEnded?: boolean;
}) {
  return {
    applied: args.applied,
    previousRange: args.previousRange ?? "^0.1.0",
    range: args.range,
    openEnded: args.openEnded ?? false,
    check: {
      id: "notes",
      outcome: "update-available",
      installed,
      candidate: {
        version: "b".repeat(40),
        label: "0.2.0",
        display: "https://github.com/acme/notes@v0.2.0 (bbbbbbbbbbbb)",
      },
    },
  };
}

type Body = { range: string; dryRun?: boolean };

function stubTrackingServer(
  respond: (body: Body) => Response = (body) =>
    Response.json(
      trackingResult({ applied: body.dryRun !== true, range: body.range }),
    ),
) {
  const bodies: Body[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/plugins/notes/tracking-range") {
        const body = JSON.parse(String(init?.body)) as Body;
        bodies.push(body);
        return respond(body);
      }
      if (url === "/api/v1/plugins/updates/check") {
        return Response.json({ results: [] });
      }
      if (url === "/api/v1/plugins/notes/source") {
        return Response.json({
          requested: GIT_PLUGIN.source,
          resolved: installed.display,
          range: "^0.1.0",
          resolvedTag: "v0.1.0",
          engines: {},
          installedAt: 1,
          history: [],
        });
      }
      return Response.json({ plugins: [] });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { bodies, fetchMock };
}

const queryClients: QueryClient[] = [];

function renderDialog(
  plugin: PluginListItem = GIT_PLUGIN,
  tracking: PluginTrackingSpec = { kind: "range", range: "^0.1.0" },
) {
  const harness = createQueryClientTestHarness();
  queryClients.push(harness.queryClient);
  const Wrapper = harness.wrapper;
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <Wrapper>
        <ChangeTrackingRangeDialog
          plugin={plugin}
          tracking={tracking}
          open
          onOpenChange={onOpenChange}
        />
      </Wrapper>
    </MemoryRouter>,
  );
  return { ...harness, onOpenChange };
}

function rangeInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Update range" });
}

function changeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Change range" });
}

afterEach(async () => {
  cleanup();
  try {
    await vi.waitFor(() => {
      expect(queryClients.every((client) => client.isMutating() === 0)).toBe(
        true,
      );
    });
  } finally {
    for (const client of queryClients.splice(0)) client.clear();
    resetNotificationStore();
    vi.unstubAllGlobals();
  }
});

describe("ChangeTrackingRangeDialog", () => {
  it("previews the typed range, then changes it and refreshes the plugin", async () => {
    const { bodies } = stubTrackingServer();
    const { queryClient, onOpenChange } = renderDialog();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    expect(rangeInput().value).toBe("^0.1.0");
    expect(changeButton().disabled).toBe(true);
    fireEvent.change(rangeInput(), { target: { value: " >=0.1.0 <1.0.0 " } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      (await screen.findByRole("status", { name: "Range preview" }))
        .textContent,
    ).toBe("Offers 0.2.0.");
    expect(changeButton().disabled).toBe(false);
    fireEvent.click(changeButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(bodies).toEqual([
      { range: ">=0.1.0 <1.0.0", dryRun: true },
      { range: ">=0.1.0 <1.0.0" },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: allPluginListQueryKeyPrefix(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pluginSourceQueryKey("notes"),
    });
    expect(
      getNotifications().map(({ title, description }) => ({
        title,
        description,
      })),
    ).toEqual([
      {
        title: "Notes now tracks >=0.1.0 <1.0.0",
        description: "Offers 0.2.0.",
      },
    ]);
  });

  it("asks for a new preview after the range is edited", async () => {
    const { bodies } = stubTrackingServer();
    renderDialog();

    fireEvent.change(rangeInput(), { target: { value: "^0.2.0" } });
    fireEvent.keyDown(rangeInput(), { key: "Enter" });
    await screen.findByRole("status", { name: "Range preview" });
    expect(changeButton().disabled).toBe(false);

    fireEvent.change(rangeInput(), { target: { value: "^0.3.0" } });
    expect(changeButton().disabled).toBe(true);
    expect(screen.queryByRole("status", { name: "Range preview" })).toBeNull();
    expect(bodies).toEqual([{ range: "^0.2.0", dryRun: true }]);
  });

  it("clears a failed change once the range is previewed again or edited", async () => {
    stubTrackingServer((body) =>
      body.dryRun === true
        ? Response.json(trackingResult({ applied: false, range: body.range }))
        : Response.json(
            { error: 'plugin "notes" changed while its range was changing' },
            { status: 409 },
          ),
    );
    renderDialog();

    fireEvent.change(rangeInput(), { target: { value: "^0.2.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("status", { name: "Range preview" });
    fireEvent.click(changeButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      'plugin "notes" changed while its range was changing',
    );

    fireEvent.keyDown(rangeInput(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await screen.findByRole("status", { name: "Range preview" });
    fireEvent.click(changeButton());
    await screen.findByRole("alert");

    fireEvent.change(rangeInput(), { target: { value: "^0.3.0" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a refusal and keeps the change disabled", async () => {
    stubTrackingServer(() =>
      Response.json(
        {
          error:
            '"0.2.0" names a single version, not a range; use a range like ^0.2.0',
        },
        { status: 422 },
      ),
    );
    renderDialog();

    fireEvent.change(rangeInput(), { target: { value: "0.2.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      '"0.2.0" names a single version, not a range; use a range like ^0.2.0',
    );
    expect(changeButton().disabled).toBe(true);
  });

  it("warns that a range without an upper bound offers every future major release", async () => {
    const { bodies } = stubTrackingServer((body) =>
      Response.json(
        trackingResult({
          applied: body.dryRun !== true,
          range: body.range,
          openEnded: true,
        }),
      ),
    );
    const { onOpenChange } = renderDialog();

    fireEvent.change(rangeInput(), { target: { value: ">=0.1.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      (await screen.findByRole("status", { name: "Range preview" }))
        .textContent,
    ).toBe(
      "Offers 0.2.0.This range has no upper bound, so every future major release will be offered as an update.",
    );
    fireEvent.click(changeButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(bodies).toEqual([
      { range: ">=0.1.0", dryRun: true },
      { range: ">=0.1.0" },
    ]);
  });

  it("reports the current range as unchanged, without a warning", async () => {
    stubTrackingServer((body) =>
      Response.json(
        trackingResult({
          applied: false,
          range: body.range,
          previousRange: ">=0.1.0",
          openEnded: true,
        }),
      ),
    );
    renderDialog(GIT_PLUGIN, { kind: "range", range: ">=0.1.0" });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      (await screen.findByRole("status", { name: "Range preview" }))
        .textContent,
    ).toBe("Notes already tracks >=0.1.0.");
    expect(changeButton().disabled).toBe(true);
  });

  it.each([
    {
      currentRange: "^0.1.0",
      outside: "0.2.0",
      suggested: ">=0.1.0 <1.0.0",
    },
    {
      currentRange: "^1.4.0",
      outside: "2.0.0",
      suggested: ">=1.4.0 <3.0.0",
    },
  ])(
    "opens on the server's suggestion $suggested to reach $outside, outside $currentRange",
    async ({ currentRange, outside, suggested }) => {
      const { bodies } = stubTrackingServer();
      renderDialog(
        makePluginListItem({
          ...GIT_PLUGIN,
          version: "9.9.9",
          updateState: {
            ...GIT_PLUGIN.updateState,
            outsideRange: {
              version: outside,
              display: `https://github.com/acme/notes@v${outside} (cccccccccccc)`,
              breaking: true,
              range: currentRange,
              suggestedRange: suggested,
            },
          },
        }),
        { kind: "range", range: currentRange },
      );

      expect(rangeInput().value).toBe(suggested);
      expect(
        screen.getByText(
          `Suggested to include ${outside}, the newest release outside ${currentRange}.`,
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      await screen.findByRole("status", { name: "Range preview" });
      expect(bodies).toEqual([{ range: suggested, dryRun: true }]);
    },
  );

  it("opens on the current range when the server suggests none for a release outside it", () => {
    stubTrackingServer();
    renderDialog(
      makePluginListItem({
        ...GIT_PLUGIN,
        updateState: {
          ...GIT_PLUGIN.updateState,
          outsideRange: {
            version: "0.2.0",
            display: "https://github.com/acme/notes@v0.2.0 (cccccccccccc)",
            breaking: true,
            range: "^0.1.0",
          },
        },
      }),
    );

    expect(rangeInput().value).toBe("^0.1.0");
    expect(screen.queryByText(/^Suggested to include/u)).toBeNull();
  });

  it.each([
    [
      { kind: "none" },
      "This install follows no semver range yet. Choose which releases bb offers as updates.",
    ],
    [
      { kind: "dist-tag", tag: "beta" },
      "Currently follows the npm dist-tag beta. Choose which releases bb offers as updates.",
    ],
    [
      { kind: "latest" },
      "Currently follows its latest release. Choose which releases bb offers as updates.",
    ],
  ] as const)(
    "starts an npm install that follows %j from its installed version",
    (tracking, description) => {
      stubTrackingServer();
      renderDialog(
        makePluginListItem({
          id: "notes",
          name: "Notes",
          source: "npm:bb-plugin-notes@1.4.0",
          version: "1.4.0",
          provenance: "direct",
        }),
        tracking,
      );

      expect(rangeInput().value).toBe("^1.4.0");
      expect(screen.getByText(description)).toBeTruthy();
    },
  );
});

describe("trackingRangeCheckSummary", () => {
  const candidate = {
    version: "b".repeat(40),
    label: "0.2.0",
    display: "https://github.com/acme/notes@v0.2.0 (bbbbbbbbbbbb)",
  };
  const outsideRange = {
    version: "1.0.0",
    display: "https://github.com/acme/notes@v1.0.0 (dddddddddddd)",
    breaking: true,
    range: "^0.2.0",
    suggestedRange: ">=0.2.0 <2.0.0",
  };

  it.each([
    [
      {
        id: "notes",
        outcome: "update-available" as const,
        installed,
        candidate,
      },
      "Offers 0.2.0.",
    ],
    [
      {
        id: "notes",
        outcome: "update-available" as const,
        installed,
        candidate,
        candidateBreaking: true as const,
        outsideRange,
      },
      "Offers 0.2.0, which may include breaking changes. 1.0.0 stays outside this range.",
    ],
    [
      { id: "notes", outcome: "current" as const, installed, outsideRange },
      "0.1.0 is the newest compatible release in this range. 1.0.0 stays outside this range.",
    ],
    [
      {
        id: "notes",
        outcome: "incompatible" as const,
        installed,
        blocked: {
          version: "c".repeat(40),
          label: "0.3.0",
          reasons: ["requires bb >=99.0.0"],
        },
      },
      "0.3.0 doesn’t run on this bb: requires bb >=99.0.0",
    ],
    [
      {
        id: "notes",
        outcome: "unavailable" as const,
        installed,
        detail: "git ls-remote failed",
      },
      "git ls-remote failed",
    ],
  ])("summarizes %#", (check, summary) => {
    expect(trackingRangeCheckSummary(check)).toBe(summary);
  });
});

describe("pluginTrackingSpec", () => {
  const noSpec = { range: null, npmSpecKind: null, distTag: null };
  const npmPlugin = makePluginListItem({ source: "npm:bb-plugin-notes@1.4.0" });

  it("offers range changes for git range and npm installs only", () => {
    expect(
      pluginTrackingSpec(GIT_PLUGIN, { ...noSpec, range: "^0.1.0" }),
    ).toEqual({ kind: "range", range: "^0.1.0" });
    expect(
      pluginTrackingSpec(
        makePluginListItem({
          source: "git:https://github.com/acme/notes@main",
        }),
        noSpec,
      ),
    ).toBeUndefined();
    expect(
      pluginTrackingSpec(
        makePluginListItem({ source: "path:/work/notes" }),
        noSpec,
      ),
    ).toBeUndefined();
    expect(
      pluginTrackingSpec(
        makePluginListItem({ source: "builtin:notes", provenance: "builtin" }),
        noSpec,
      ),
    ).toBeUndefined();
    expect(pluginTrackingSpec(GIT_PLUGIN, undefined)).toBeUndefined();
  });

  it.each([
    [
      { range: "^1.4.0", npmSpecKind: "range", distTag: null },
      { kind: "range", range: "^1.4.0" },
    ],
    [
      { range: null, npmSpecKind: "tag", distTag: "beta" },
      { kind: "dist-tag", tag: "beta" },
    ],
    [
      { range: null, npmSpecKind: "default", distTag: null },
      { kind: "latest" },
    ],
    [{ range: null, npmSpecKind: "exact", distTag: null }, { kind: "none" }],
    [noSpec, { kind: "none" }],
  ])("describes the npm source %j as %j", (source, tracking) => {
    expect(pluginTrackingSpec(npmPlugin, source)).toEqual(tracking);
  });
});

describe("PluginDetail update range", () => {
  it("shows the range in Details and opens the dialog from it", async () => {
    stubTrackingServer();
    const harness = createQueryClientTestHarness();
    queryClients.push(harness.queryClient);
    const Wrapper = harness.wrapper;
    render(
      <MemoryRouter>
        <Wrapper>
          <PluginDetail
            isLoading={false}
            plugin={GIT_PLUGIN}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
            catalogEntries={[]}
            onOpenPlugin={() => undefined}
          />
        </Wrapper>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Update range", { selector: "dt" }),
    ).toBeTruthy();
    expect(screen.getByText("^0.1.0")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Change the update range of Notes",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Change the update range of Notes",
      }),
    ).toBeTruthy();
    expect(rangeInput().value).toBe("^0.1.0");
  });

  it.each([
    [{ npmSpecKind: "tag", distTag: "beta" }, "beta dist-tag"],
    [{ npmSpecKind: "default", distTag: null }, "Latest release"],
  ])("shows what an npm install without a range follows: %j", (spec, label) => {
    const harness = createQueryClientTestHarness();
    queryClients.push(harness.queryClient);
    const Wrapper = harness.wrapper;
    const plugin = makePluginListItem({
      id: "notes",
      name: "Notes",
      source: "npm:bb-plugin-notes@beta",
      version: "1.4.0",
      provenance: "direct",
    });
    harness.queryClient.setQueryData(pluginSourceQueryKey(plugin.id), {
      requested: plugin.source,
      resolved: "bb-plugin-notes@1.4.0",
      range: null,
      ...spec,
      integrity: null,
      registry: null,
      engines: { bb: null, bbPluginSdk: null },
      installedAt: 1,
      history: [],
    });
    render(
      <MemoryRouter>
        <Wrapper>
          <PluginDetail
            isLoading={false}
            plugin={plugin}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
            catalogEntries={[]}
            onOpenPlugin={() => undefined}
          />
        </Wrapper>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Change the update range of Notes" })
        .parentElement?.textContent,
    ).toBe(`${label}Change range…`);
  });

  it("has no range control for a local path plugin", () => {
    const harness = createQueryClientTestHarness();
    queryClients.push(harness.queryClient);
    const Wrapper = harness.wrapper;
    const plugin = makePluginListItem({
      id: "local",
      source: "path:/work/local",
    });
    harness.queryClient.setQueryData(pluginSourceQueryKey(plugin.id), {
      requested: plugin.source,
      resolved: plugin.source,
      range: null,
      npmSpecKind: null,
      distTag: null,
      integrity: null,
      registry: null,
      engines: { bb: null, bbPluginSdk: null },
      installedAt: 1,
      history: [],
    });
    render(
      <MemoryRouter>
        <Wrapper>
          <PluginDetail
            isLoading={false}
            plugin={plugin}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
            catalogEntries={[]}
            onOpenPlugin={() => undefined}
          />
        </Wrapper>
      </MemoryRouter>,
    );

    expect(screen.getByText("Version", { selector: "dt" })).toBeTruthy();
    expect(screen.queryByText("Update range")).toBeNull();
  });
});
