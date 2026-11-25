// @vitest-environment jsdom

import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import "../../../.ladle/plugin-runtime";
import { ActionAlignment } from "./PluginThreadList.stories";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the Action alignment story's rows with Ladle's plugin runtime", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { container } = render(
    <MemoryRouter>
      <ActionAlignment />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(
      container.querySelector(
        '[data-sidebar-thread-id="thr_actions_leaf_short"]',
      ),
    ).not.toBeNull(),
  );
});

it("keeps every Ladle story on the plugin runtime Ladle installs", () => {
  const stories = globSync(
    ["apps/app/{src,.ladle}/**/*.stories.tsx", "plugins/**/*.stories.tsx"],
    { cwd: repoRoot, exclude: (path) => path.includes("node_modules") },
  );
  expect(stories.length).toBeGreaterThan(0);
  const offenders = stories.filter((story) =>
    readFileSync(join(repoRoot, story), "utf8").includes(
      "@get-bb/plugin-sdk/testing/app",
    ),
  );
  expect(offenders).toEqual([]);
});
