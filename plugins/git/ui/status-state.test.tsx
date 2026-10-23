// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeWorkspaceStatus } from "../testing.js";
import { gitRpcContract } from "../rpc-contract.js";
import { gitStatusTag } from "../contract.js";
import { GitStatusInfoRow } from "./info/GitInfoRows.js";
import { useGitStatus } from "./queries.js";

afterEach(cleanup);

function Status() {
  const { workspace, errorMessage } = useGitStatus("env-1");
  return (
    <output aria-label="status">
      {workspace?.branch.currentBranch ?? "none"}|{errorMessage ?? "ok"}
    </output>
  );
}

it("keeps the last known status when a refresh fails", async () => {
  let fail = false;
  const rendered = renderSlot(
    { component: Status },
    {},
    {
      rpc: {
        status: ({ keys }) =>
          Object.fromEntries(
            keys.map((key) => [
              key,
              fail
                ? { outcome: "failed" as const, message: "git timed out" }
                : {
                    outcome: "available" as const,
                    workspace: makeWorkspaceStatus({
                      branch: { currentBranch: "feature", defaultBranch: "main" },
                    }),
                  },
            ]),
          ),
      } as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  const status = () => screen.getByRole("status", { name: "status" }).textContent;
  await waitFor(() => expect(status()).toBe("feature|ok"));

  fail = true;
  await rendered.experimental_invalidateRpc([gitStatusTag("env-1")]);

  await waitFor(() => expect(status()).toBe("feature|git timed out"));
});

it("keeps core's Workspace not found row for a destroyed environment", () => {
  renderSlot(
    {
      component: (props: Parameters<typeof GitStatusInfoRow>[0]) => (
        <TooltipProvider>
          <GitStatusInfoRow {...props} />
        </TooltipProvider>
      ),
    },
    {
      threadId: "thr-1",
      projectId: "prj-1",
      environment: null,
      environmentState: {
        state: "loaded",
        id: "env-1",
        status: "destroyed",
        hostActive: true,
        isGitRepo: true,
        managed: true,
        path: null,
        mergeBaseBranch: null,
        baseBranch: null,
        defaultBranch: "main",
      },
      threadArchived: false,
    },
    { pluginId: "bb--git", experimental_rpcContract: gitRpcContract },
  );
  expect(screen.getByText("Workspace not found")).toBeTruthy();
});
