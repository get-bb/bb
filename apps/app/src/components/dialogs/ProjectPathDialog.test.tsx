// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectPathDialog } from "./ProjectPathDialog";

afterEach(() => {
  cleanup();
});

describe("ProjectPathDialog", () => {
  it("keeps validation errors visible until the path changes", async () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostName={null}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "relative/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(
      screen.getByText("Project path must be an absolute path."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/srv/repos/demo" },
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Project path must be an absolute path."),
      ).toBeNull();
    });
  });

  it("names the host in the description when provided", () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform={null}
        hostName="Sawyer's MacBook"
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Enter an absolute path on Sawyer's MacBook to the project folder.",
      ),
    ).toBeTruthy();
  });
});
