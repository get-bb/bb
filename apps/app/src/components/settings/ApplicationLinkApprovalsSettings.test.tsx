// @vitest-environment jsdom

import {
  createApplicationLinkApprovals,
  APPLICATION_LINK_APPROVALS_STORAGE_KEY,
} from "@bb/domain/application-link-approvals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { appQueryClient } from "@/lib/app-query-client";
import { ApplicationLinkApprovalsSettings } from "./ApplicationLinkApprovalsSettings";

afterEach(() => {
  cleanup();
  localStorage.removeItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY);
  appQueryClient.clear();
});

it("revokes approvals and refreshes the list", async () => {
  const store = createApplicationLinkApprovals({
    read: () => localStorage.getItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY),
    write: (value) =>
      localStorage.setItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY, value),
  });
  store.allow("linear", store.revision());
  store.allow("reflect", store.revision());
  render(
    <QueryClientProvider client={appQueryClient}>
      <ApplicationLinkApprovalsSettings />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove linear approval" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove reflect approval" }),
  );
  await screen.findByText(/^No apps are always allowed\./u);
  expect(store.list()).toEqual([]);
});
