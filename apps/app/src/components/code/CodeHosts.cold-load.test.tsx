// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { PluginDiff } from "@/components/plugin/PluginDiff";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import { DiffHost } from "./DiffHost";
import { SourceCodeHost } from "./SourceCodeHost";

const downloads = await vi.hoisted(async () => {
  const { createDeferredPromise } = await import("@bb/test-helpers");
  return {
    diff: createDeferredPromise<void>(),
    source: createDeferredPromise<void>(),
  };
});

vi.mock("./BbDiff", async () => {
  await downloads.diff.promise;
  return { default: () => <p>Diff ready</p> };
});
vi.mock("./BbSourceCode", async () => {
  await downloads.source.promise;
  return { default: () => <p>Source ready</p> };
});

afterEach(cleanup);

it("shows the renderer skeleton until the renderer imports resolve", async () => {
  const patch = [
    "diff --git a/app.ts b/app.ts",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1 +1 @@",
    "-const a = 1;",
    "+const a = 2;",
    "",
  ].join("\n");
  const file = parseGitDiffFiles(patch)[0];
  if (!file) throw new Error("fixture patch did not parse");
  const hosts = render(
    <>
      <DiffHost file={file} fullFileContents={null} />
      <SourceCodeHost content="const a = 2;" path="app.ts" />
    </>,
  );
  const sdk = render(
    <>
      <PluginDiff patch={patch} path="app.ts" />
      <PluginSourceCode content="const a = 2;" path="app.ts" />
    </>,
  );

  for (const view of [hosts, sdk]) {
    expect(
      view.container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
  }
  expect(screen.queryByText("Diff ready")).toBeNull();
  expect(screen.queryByText("Source ready")).toBeNull();

  await act(async () => {
    downloads.diff.resolve();
    downloads.source.resolve();
  });

  expect(await screen.findAllByText("Diff ready")).toHaveLength(2);
  expect(await screen.findAllByText("Source ready")).toHaveLength(2);
  for (const view of [hosts, sdk]) {
    expect(view.container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  }
});
