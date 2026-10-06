// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

const pipeline = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release, imports: 0 };
});

vi.mock("./markdown-html", async (original) => {
  pipeline.imports += 1;
  await pipeline.held;
  return original();
});

afterEach(cleanup);

it("keeps plain Markdown immediate and HTML safe while the real pipeline downloads", async () => {
  const view = render(
    <MarkdownPreview content="**Already readable**" allowHtml />,
  );
  expect(screen.getByText("Already readable").tagName).toBe("STRONG");
  await act(async () => {});
  expect(pipeline.imports).toBe(0);
  view.rerender(
    <MarkdownPreview
      content={
        'Text <video controls src="https://example.com/movie.mp4"></video>'
      }
    />,
  );
  await act(async () => {});
  expect(pipeline.imports).toBe(0);
  const content =
    'Still readable\n\n<video controls src="https://example.com/movie.mp4" onerror="alert(1)"></video><script>alert(1)</script>';
  view.rerender(<MarkdownPreview content={content} allowHtml />);
  await act(async () => {});
  expect(pipeline.imports).toBe(1);
  expect(screen.getByText("Still readable")).toBeTruthy();
  expect(screen.getByLabelText("Loading embedded HTML")).toBeTruthy();
  expect(view.container.querySelector("video, script")).toBeNull();
  await act(async () => pipeline.release());
  await waitFor(() =>
    expect(view.container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/movie.mp4",
    ),
  );
  expect(view.container.querySelector("script, [onerror]")).toBeNull();
  expect(screen.queryByLabelText("Loading embedded HTML")).toBeNull();
});
