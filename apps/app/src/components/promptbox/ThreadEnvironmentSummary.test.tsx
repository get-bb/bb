// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";
import { focusWithKeyboard } from "@/test/keyboard-focus";

afterEach(cleanup);

describe("ThreadEnvironmentSummary", () => {
  it("shows the laptop icon and host name for a persistent machine", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Mac Studio"
          environmentHost={{
            machineProviderId: null,
            name: "Mac Studio",
            type: "persistent",
          }}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Mac Studio")).toBeTruthy();
    expect(container.querySelector('[data-icon="Laptop"]')).not.toBeNull();
  });

  it("shows the provider icon and host name for an ephemeral machine", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Modal sandbox ugxe6e"
          environmentHost={{
            machineProviderId: "modal-sandbox",
            name: "Modal sandbox ugxe6e",
            type: "ephemeral",
          }}
          environmentMachineProvider={{
            id: "modal-sandbox",
            displayName: "Modal Sandbox",
            icon: "Cloud",
            logoUrl: null,
          }}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Modal sandbox ugxe6e")).toBeTruthy();
    expect(container.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Laptop"]')).toBeNull();
  });

  it("uses a host-free environment label in compact prompt boxes", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Mac Studio · New worktree"
          environmentCompactLabel="Worktree"
        />
      </TooltipProvider>,
    );

    expect(
      container.querySelector('[data-promptbox-full-label=""]')?.textContent,
    ).toBe("Mac Studio · New worktree");
    expect(
      container.querySelector('[data-promptbox-compact-label=""]')?.textContent,
    ).toBe("Worktree");
  });

  it("names the environment in its title rather than repeating it in a tooltip", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's MacBook Pro"
          environmentCompactLabel="Bersabel's MacBook Pro"
        />
      </TooltipProvider>,
    );

    const environmentDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(environmentDisplay).not.toBeNull();
    expect(environmentDisplay!.className).not.toContain("max-w-[10rem]");
    expect(environmentDisplay!.getAttribute("title")).toBe(
      "Environment: Bersabel's MacBook Pro",
    );
    expect(environmentDisplay!.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps matching environment and branch labels visibly separate", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="bb/fix-environment-summary"
          environmentCompactLabel="bb/fix-environment-summary"
          environmentIcon="FolderGit"
          environmentProviderName="Worktree"
          environmentCheckout={{
            copyErrorMessage: "Failed to copy branch name",
            copyLabel: "Copy branch name",
            copySuccessMessage: "Branch name copied",
            copyValue: "bb/fix-environment-summary",
            label: "bb/fix-environment-summary",
            rowLabel: "Branch",
            title: "Copy branch name: bb/fix-environment-summary",
          }}
        />
      </TooltipProvider>,
    );

    const copyButton = screen.getByRole("button", {
      name: "bb/fix-environment-summary",
    });
    expect(screen.getAllByText("bb/fix-environment-summary")).toHaveLength(3);
    expect(copyButton.textContent).toBe("bb/fix-environment-summary");
    expect(copyButton.querySelector('[data-icon="GitBranch"]')).not.toBeNull();
    expect(copyButton.querySelector('[data-icon="Copy"]')).toBeNull();
  });

  it("names the environment provider from its icon when the label differs", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Michael-M4"
          environmentCompactLabel="Michael-M4"
          environmentIcon="Laptop"
          environmentProviderName="Personal workspace"
        />
      </TooltipProvider>,
    );

    focusWithKeyboard(screen.getByRole("img", { name: "Personal workspace" }));

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Personal workspace",
    );
  });

  it("leaves the icon decorative when its tooltip would repeat the label", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Personal workspace"
          environmentCompactLabel="Personal workspace"
          environmentIcon="Folder"
          environmentProviderName="Personal workspace"
        />
      </TooltipProvider>,
    );

    expect(
      screen.queryByRole("img", { name: "Personal workspace" }),
    ).toBeNull();
    expect(container.querySelector('[data-icon="Folder"]')).not.toBeNull();
  });

  it("explains the create-thread action in a tooltip", async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Worktree"
          onCreateNewThreadInEnvironment={vi.fn()}
        />
      </TooltipProvider>,
    );

    const createThreadButton = screen.getByRole("button", {
      name: "New thread in this environment",
    });
    expect(createThreadButton.classList).toContain("text-subtle-foreground/75");
    expect(createThreadButton.classList).toContain(
      "hover:text-muted-foreground",
    );
    expect(
      container.querySelector('[data-icon="MessageSquarePlus"]'),
    ).not.toBeNull();
    focusWithKeyboard(createThreadButton);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "New thread in this environment",
    );
  });
});
