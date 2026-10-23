// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PullRequest } from "bb-plugin-bb--github-pr-status/contract";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { PullRequestLink } from "../../../../../plugins/github-pr-status/ui/PullRequestContextSegment";
import { PullRequestRow } from "../../../../../plugins/github-pr-status/ui/PullRequestInfoRow";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  PluginUrlClaimContext,
  type OpenClaimedUrl,
} from "./plugin-url-claims";

const PULL_URL = "https://github.com/acme/bb/pull/128";
const PR_STATUS_PLUGIN_ID = "bb--github-pr-status";

const pullRequest: PullRequest = {
  number: 128,
  title: "Open pull requests in the GitHub side panel",
  state: "open",
  url: PULL_URL,
  baseRefName: "main",
  headRefName: "bb/pr-side-panel",
  updatedAt: "2026-10-21T12:30:00Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: { state: "none", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

interface MountedSurface {
  link: HTMLElement;
  openedWithoutPlugins(): boolean;
}

interface Surface {
  name: string;
  callerPluginId: string | null;
  mount(openClaimedUrl: OpenClaimedUrl): MountedSurface;
}

type RuntimeHost = typeof globalThis & { __bbPluginRuntime?: unknown };

function mountInThreadView(openClaimedUrl: OpenClaimedUrl, content: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PluginUrlClaimContext.Provider value={openClaimedUrl}>
          <UrlOpenRoutingProvider openInAppBrowser={null}>
            {content}
          </UrlOpenRoutingProvider>
        </PluginUrlClaimContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mountPullRequestStatusLink(
  openClaimedUrl: OpenClaimedUrl,
  content: ReactNode,
): MountedSurface {
  const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
  mountInThreadView(
    openClaimedUrl,
    <PluginSlotMount
      pluginId={PR_STATUS_PLUGIN_ID}
      slotKind="test"
      slotId="pull-request"
    >
      {content}
    </PluginSlotMount>,
  );
  return {
    link: screen.getByRole("link", { name: /^Pull request 128:/ }),
    openedWithoutPlugins: () =>
      openWindow.mock.calls.some(([url]) => url === PULL_URL),
  };
}

const surfaces: readonly Surface[] = [
  {
    name: "a Markdown link",
    callerPluginId: null,
    mount(openClaimedUrl) {
      const onOpenLink = vi.fn<(link: { href: string }) => boolean>(() => true);
      mountInThreadView(
        openClaimedUrl,
        <MarkdownPreview
          content={`See [the pull request](${PULL_URL}).`}
          linkRouting={{ onOpenLink }}
        />,
      );
      return {
        link: screen.getByRole("link", { name: "the pull request" }),
        openedWithoutPlugins: () =>
          onOpenLink.mock.calls.some(([link]) => link.href === PULL_URL),
      };
    },
  },
  {
    name: "the prompt banner's pull request",
    callerPluginId: PR_STATUS_PLUGIN_ID,
    mount: (openClaimedUrl) =>
      mountPullRequestStatusLink(
        openClaimedUrl,
        <PullRequestLink
          pullRequest={pullRequest}
          segments={[
            {
              key: `${PR_STATUS_PLUGIN_ID}/pull-request`,
              pluginId: PR_STATUS_PLUGIN_ID,
            },
          ]}
        />,
      ),
  },
  {
    name: "the Info tab's pull request",
    callerPluginId: PR_STATUS_PLUGIN_ID,
    mount: (openClaimedUrl) =>
      mountPullRequestStatusLink(
        openClaimedUrl,
        <PullRequestRow pullRequest={pullRequest} />,
      ),
  },
];

beforeAll(() => installPluginRuntime());

afterAll(() => {
  delete (globalThis as RuntimeHost).__bbPluginRuntime;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(surfaces)("$name in a thread view", (surface) => {
  it("opens the tab of the plugin that claims it on a plain click", () => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => true);
    const { link, openedWithoutPlugins } = surface.mount(openClaimedUrl);

    expect(fireEvent.click(link)).toBe(false);
    expect(openClaimedUrl).toHaveBeenCalledExactlyOnceWith(
      PULL_URL,
      surface.callerPluginId,
    );
    expect(openedWithoutPlugins()).toBe(false);
  });

  it("opens the URL as before when no plugin tab takes it", () => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => false);
    const { link, openedWithoutPlugins } = surface.mount(openClaimedUrl);

    fireEvent.click(link);
    expect(openClaimedUrl).toHaveBeenCalledExactlyOnceWith(
      PULL_URL,
      surface.callerPluginId,
    );
    expect(openedWithoutPlugins()).toBe(true);
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])("never offers a %s-click to plugins", (_name, modifiers) => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => true);
    const { link } = surface.mount(openClaimedUrl);

    fireEvent.click(link, modifiers);
    expect(openClaimedUrl).not.toHaveBeenCalled();
  });
});
