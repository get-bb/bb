// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppToastContent } from "./app-toast";

afterEach(cleanup);

describe("AppToastContent", () => {
  it("keeps diagnostic toast text selectable without including actions", () => {
    render(
      <AppToastContent
        action={{ label: "Retry", onClick: () => undefined }}
        description="Connection refused at host_remote"
        title="Machine update failed"
        tone="error"
      />,
    );

    expect(
      screen.getByText("Machine update failed").closest(".select-text"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry" }).classList,
    ).not.toContain("select-text");
  });
});
