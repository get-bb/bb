import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Environment, Host, Thread } from "@bb/domain";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import type {
  SystemEnvironmentProvider,
  SystemMachineProvider,
} from "@bb/server-contract";
import { systemEnvironmentProvidersQueryKey } from "@/hooks/queries/environment-provider-queries";
import {
  hostsQueryKey,
  systemMachineProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  makeEnvironment,
  makeHost,
  makeThread as makeThreadFixture,
} from "@bb/test-helpers/domain-fixtures";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "@bb/test-helpers";
import {
  EnvironmentProvisioningFailureRow,
  EnvironmentRow,
  formatBranchComparison,
  GitStatusRow,
} from "./ThreadMetadataContent";

const localHost = { locality: "local", identity: null } as const;
const connectedLocalHost: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: { name: "Michael-M4", connected: true },
};

function withQueryClient(
  children: ReactNode,
  registeredProviders?: readonly SystemEnvironmentProvider[],
  machines?: {
    hosts: readonly Host[];
    providers: readonly SystemMachineProvider[];
  },
): ReactNode {
  const queryClient = new QueryClient();
  queryClient.setQueryData(hostsQueryKey(), machines?.hosts ?? []);
  queryClient.setQueryData(
    systemMachineProvidersQueryKey(),
    machines?.providers ?? [],
  );
  if (registeredProviders !== undefined) {
    queryClient.setQueryData(
      systemEnvironmentProvidersQueryKey({}),
      registeredProviders,
    );
  }
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const worktreeProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "git-worktree",
  displayName: "Worktree",
  description: "Prepare a workspace for this thread.",
  icon: "GitBranch",
  logoUrl: null,
  pluginId: "environment-git-worktree",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

const modalProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "modal-sandbox",
  displayName: "Modal sandbox",
  description: "Prepare a workspace for this thread.",
  icon: "Cloud",
  logoUrl: null,
  pluginId: "environment-modal-sandbox",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: true,
    projectless: false,
  },
  inputs: null,
};

const personalProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "personal-workspace",
  displayName: "Personal workspace",
  description: "Prepare a workspace for this thread.",
  icon: "Folder",
  logoUrl: null,
  pluginId: "environment-personal-workspace",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: false,
    projectless: true,
  },
  inputs: null,
};

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    title: null,
    titleFallback: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    updatedAt: 0,
    ...overrides,
  });
}

function renderEnvironmentRow(
  environment: Environment,
  registeredProviders?: readonly SystemEnvironmentProvider[],
  environmentDisplayHost: EnvironmentDisplayHostContext = localHost,
  machines?: {
    hosts: readonly Host[];
    providers: readonly SystemMachineProvider[];
  },
): string {
  return renderToStaticMarkup(
    withQueryClient(
      <TooltipProvider>
        <MemoryRouter>
          <EnvironmentRow
            thread={makeThread({ environmentId: environment.id })}
            environment={environment}
            environmentDisplayHost={environmentDisplayHost}
          />
        </MemoryRouter>
      </TooltipProvider>,
      registeredProviders,
      machines,
    ),
  );
}

describe("EnvironmentRow", () => {
  it("shows an unregistered provider id as not installed", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ environmentProviderId: "retired-cloud" }),
      [],
      connectedLocalHost,
    );

    expect(markup).toContain("retired-cloud (not installed)");
  });

  it("shows the provider icon and host name without provider kind text", () => {
    const environment = makeEnvironment({ hostId: "host_modal" });
    const markup = renderEnvironmentRow(
      environment,
      [],
      {
        locality: "remote",
        identity: { name: "Modal sandbox abc123", connected: true },
      },
      {
        hosts: [
          makeHost({
            id: "host_modal",
            name: "Modal sandbox abc123",
            type: "ephemeral",
            machineProviderId: "modal-sandbox",
          }),
        ],
        providers: [
          {
            id: "modal-sandbox",
            displayName: "Modal machine",
            description: "Run a machine for development.",
            icon: "Cloud",
            logoUrl: null,
            pluginId: "environment-modal-sandbox",
            inputs: null,
            acceptsEmptyInputs: true,
            supportsSuspend: true,
          },
        ],
      },
    );

    expect(markup).toContain("Modal sandbox abc123");
    expect(markup).toContain('data-icon="Cloud"');
    expect(markup).not.toContain("Modal machine");
  });

  it("marks a removed machine and hides execution on a retained environment", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ status: "ready", hostLifecycle: "removed" }),
      [],
      {
        locality: "remote",
        identity: { name: "Old laptop", connected: false },
      },
    );
    expect(markup).toContain("Unavailable — machine removed");
    expect(markup).toContain("Old laptop");
    expect(markup).not.toContain("(offline)");
    expect(markup).not.toContain('aria-label="New thread in environment"');
  });

  it("hides the create-thread action while an environment is provisioning", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        status: "provisioning",
        path: null,
      }),
    );

    expect(markup).not.toContain('aria-label="New thread in environment"');
  });

  it("hides the create-thread action before an environment has a path", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        path: null,
      }),
    );

    expect(markup).not.toContain('aria-label="New thread in environment"');
  });

  it("offers the create-thread action on a project's own checkout", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ environmentProviderId: null }),
    );

    expect(markup).toContain('aria-label="New thread in environment"');
  });

  it("shows a custom provider label with its machine", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ environmentProviderId: "modal-sandbox" }),
      [modalProvider],
      connectedLocalHost,
    );

    expect(markup).toContain("Modal sandbox");
    expect(markup).toContain("Michael-M4");
  });

  it("shows a personal environment with the project folder icon and machine", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        environmentProviderId: "personal-workspace",
      }),
      [personalProvider],
      connectedLocalHost,
    );

    expect(markup).toContain(">Personal workspace<");
    expect(markup).toContain("Michael-M4");
    expect(markup).toContain('data-icon="Folder"');
  });

  it("shows the provider and machine without the custom environment name", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ name: "Design system polish" }),
      [worktreeProvider],
      connectedLocalHost,
    );

    expect(markup).not.toContain("Design system polish");
    expect(markup).toContain("Michael-M4");
    expect(markup).toContain("Worktree");
  });

  it("shows no provider id while the registered provider list is still loading", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({ environmentProviderId: "modal-sandbox" }),
    );

    expect(markup).not.toContain("modal-sandbox");
  });
});

describe("EnvironmentProvisioningFailureRow", () => {
  it("shows a short provisioning status without the failure detail", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentProvisioningFailureRow failed />,
    );

    expect(markup).toContain("Environment");
    expect(markup).toContain("Not created");
    expect(markup).toContain("provisioning failed");
  });
});

describe("GitStatusRow", () => {
  it("shows no live git status for an archived attached checkout", () => {
    const markup = renderToStaticMarkup(
      <GitStatusRow
        thread={makeThread({ archivedAt: 10, environmentId: "env_checkout" })}
        environment={makeEnvironment({
          id: "env_checkout",
          environmentProviderId: "project-checkout",
          managed: false,
        })}
        workspaceStatus={undefined}
        workspaceStatusError={new Error("should not have queried")}
      />,
    );

    expect(markup).toBe("");
  });

  it("compares the branch with the merge base the daemon reported", () => {
    const render = (
      mergeBase: ReturnType<typeof makeWorkspaceMergeBase> | null,
    ) =>
      renderToStaticMarkup(
        <GitStatusRow
          thread={makeThread()}
          environment={null}
          workspaceStatus={makeWorkspaceStatus({ mergeBase })}
          workspaceStatusError={null}
        />,
      );

    expect(
      render(
        makeWorkspaceMergeBase({ mergeBaseBranch: "release", aheadCount: 2 }),
      ),
    ).toContain("2 ahead of release");
    expect(render(null)).toBe("");
  });

  it("phrases the branch comparison against its merge base", () => {
    const compare = (aheadCount: number, behindCount: number) =>
      formatBranchComparison({ aheadCount, behindCount, baseBranch: "main" });
    expect(compare(0, 0)).toBe("Even with main");
    expect(compare(6, 0)).toBe("6 ahead of main");
    expect(compare(0, 3)).toBe("3 behind main");
    expect(compare(4, 2)).toBe("4 ahead, 2 behind main");
  });
});
