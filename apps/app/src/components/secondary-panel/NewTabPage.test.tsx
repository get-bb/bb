// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabPage } from "./NewTabPage";

vi.mock("./NewTabFileSearch", () => ({
  NewTabActions: () => null,
  NewTabFileSearch: () => <div data-testid="new-tab-file-search" />,
}));

afterEach(cleanup);

describe("NewTabPage", () => {
  it("uses the themeable sidebar surface on the new-thread panel", () => {
    const { container } = render(
      <NewTabPage
        currentThreadId=""
        environmentId={null}
        focusRequest={0}
        onSelect={() => undefined}
        projectId={undefined}
      />,
    );

    expect(container.firstElementChild?.classList.contains("bg-sidebar")).toBe(
      true,
    );
  });
});
