// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadListPlaceholder } from "./ThreadListPlaceholder";

afterEach(cleanup);

describe("ThreadListPlaceholder", () => {
  it("shows the loading skeleton with the same accessible label bb's list used", () => {
    render(<ThreadListPlaceholder state={{ kind: "loading" }} />);
    expect(screen.getByLabelText("Loading sidebar navigation")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("points at the plugins page when no list plugin is enabled", () => {
    render(<ThreadListPlaceholder state={{ kind: "missing" }} />);
    expect(screen.getByRole("status").textContent).toContain(
      "No thread list plugin is enabled",
    );
    expect(screen.getByRole("link", { name: "Open plugins" }).getAttribute("href")).toBe(
      "/plugins",
    );
  });

  it("names the crashed plugin and offers a reload", () => {
    const onReload = vi.fn();
    render(
      <ThreadListPlaceholder
        state={{ kind: "crashed", pluginTitle: "Thread list", onReload }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Thread list stopped working",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
