// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { LazyPluginDiff } from "@/components/plugin/lazy-plugin-renderers";
import { parseGitDiffFiles } from "@bb/shared-ui/git-diff/parsing";
import { DiffHost } from "./DiffHost";
import { settleLazyModules } from "@/test/lazy-modules";
import { SourceCodeHost } from "./SourceCodeHost";

vi.mock("./BbDiff", () => ({ default: () => <p>Diff ready</p> }));
vi.mock("./BbSourceCode", () => ({ default: () => <p>Source ready</p> }));

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
      <LazyPluginDiff patch={patch} path="app.ts" />
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

  await settleLazyModules();
  expect(screen.getAllByText("Diff ready")).toHaveLength(2);
  expect(screen.getAllByText("Source ready")).toHaveLength(2);
  for (const view of [hosts, sdk]) {
    expect(view.container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  }
});
