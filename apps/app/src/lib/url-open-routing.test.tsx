// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { APPLICATION_LINK_APPROVALS_STORAGE_KEY } from "@bb/domain/application-link-approvals";
import {
  getApplicationUrlConfirmation,
  resolveApplicationUrlConfirmation,
  applicationLinkApprovals,
} from "./application-url";
import { defaultExperiments } from "@bb/domain";
import { appToast } from "@/components/ui/app-toast";
import { appQueryClient } from "./app-query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { useAppNavigationHost } from "./app-navigation-host";
import {
  AppNavigationUrlHost,
  openUrlInExternalBrowser,
} from "./url-open-routing";

const results: boolean[] = [];

function PluginLink() {
  const navigation = useAppNavigationHost();
  return (
    <button
      onClick={() =>
        results.push(navigation.openUrl({ url: "linear://issue/123" }))
      }
    >
      Open issue
    </button>
  );
}

afterEach(() => {
  resolveApplicationUrlConfirmation("cancel");
  localStorage.removeItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY);
  cleanup();
  appQueryClient.removeQueries({ queryKey: systemConfigQueryKey() });
  results.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("gates plugin navigation and direct external opening as the experiment changes", async () => {
  const openApplicationUrl = vi.fn(async () => {});
  vi.stubGlobal("bbDesktop", { openApplicationUrl });
  render(
    <AppNavigationUrlHost>
      <PluginLink />
    </AppNavigationUrlHost>,
  );
  fireEvent.click(screen.getByRole("button"));
  openUrlInExternalBrowser("linear://issue/123");
  expect(results).toEqual([false]);
  expect(openApplicationUrl).not.toHaveBeenCalled();
  act(() => {
    appQueryClient.setQueryData(systemConfigQueryKey(), {
      experiments: { ...defaultExperiments, applicationLinks: true },
    });
  });
  fireEvent.click(screen.getByRole("button"));
  expect(results).toEqual([false, true]);
  expect(openApplicationUrl).not.toHaveBeenCalled();
  expect(getApplicationUrlConfirmation()?.target.url).toBe(
    "linear://issue/123",
  );
  resolveApplicationUrlConfirmation("open");
  await waitFor(() =>
    expect(openApplicationUrl).toHaveBeenCalledWith("linear://issue/123"),
  );
  act(() => {
    appQueryClient.setQueryData(systemConfigQueryKey(), {
      experiments: defaultExperiments,
    });
  });
  fireEvent.click(screen.getByRole("button"));
  openUrlInExternalBrowser("linear://issue/123");
  expect(results).toEqual([false, true, false]);
  expect(openApplicationUrl).toHaveBeenCalledOnce();
});

it("asks to update an older desktop client instead of falling back to browser navigation", async () => {
  appQueryClient.setQueryData(systemConfigQueryKey(), {
    experiments: { ...defaultExperiments, applicationLinks: true },
  });
  const external = vi.fn();
  vi.stubGlobal("bbDesktop", { openExternalUrl: external });
  const error = vi.spyOn(appToast, "error").mockImplementation(() => "toast");
  openUrlInExternalBrowser("linear://issue/123");
  resolveApplicationUrlConfirmation("open");
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith("Couldn't open application link", {
      description: "Update the BB desktop app to open application links.",
    }),
  );
  expect(external).not.toHaveBeenCalled();
});

it("owns desktop consent and saved approvals in the web store, including failed launches and revocation", async () => {
  appQueryClient.setQueryData(systemConfigQueryKey(), {
    experiments: { ...defaultExperiments, applicationLinks: true },
  });
  const open = vi.fn(async () => {});
  vi.stubGlobal("bbDesktop", { openApplicationUrl: open });
  const error = vi.spyOn(appToast, "error").mockImplementation(() => "toast");
  openUrlInExternalBrowser("linear://issue/1");
  resolveApplicationUrlConfirmation("cancel");
  await act(async () => {});
  expect(open).not.toHaveBeenCalled();
  expect(await applicationLinkApprovals.list()).toEqual([]);

  open.mockRejectedValueOnce(new Error("App not installed"));
  openUrlInExternalBrowser("linear://issue/2");
  resolveApplicationUrlConfirmation("always");
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(await applicationLinkApprovals.list()).toEqual([]);

  openUrlInExternalBrowser("linear://issue/3");
  resolveApplicationUrlConfirmation("always");
  await waitFor(async () =>
    expect(await applicationLinkApprovals.list()).toEqual(["linear"]),
  );
  expect(
    localStorage.getItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY),
  ).toContain("linear");
  openUrlInExternalBrowser("linear://issue/4");
  await waitFor(() =>
    expect(open).toHaveBeenLastCalledWith("linear://issue/4"),
  );
  expect(getApplicationUrlConfirmation()).toBeNull();

  await applicationLinkApprovals.revoke("linear");
  openUrlInExternalBrowser("linear://issue/5");
  expect(getApplicationUrlConfirmation()?.target.url).toBe("linear://issue/5");
  expect(open).toHaveBeenCalledTimes(3);
});
