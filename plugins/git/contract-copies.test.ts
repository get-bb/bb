import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as domain from "@bb/domain";
import {
  workspaceResolutionFailureSchema as coreResolutionFailureSchema,
} from "@bb/host-daemon-contract/workspace";
import {
  workspaceResolutionFailureSchema,
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  gitBranchOptionsSchema,
  gitCheckoutRefSchema,
} from "bb-environment-provider-host/git-types";
import { workspaceDiffTargetSchema } from "./contract.js";

describe("git schemas defined both in core and outside it", () => {
  it.each([
    [
      "diff target",
      workspaceDiffTargetSchema,
      domain.workspaceDiffTargetSchema,
    ],
    ["branch options", gitBranchOptionsSchema, domain.gitBranchOptionsSchema],
    ["checkout ref", gitCheckoutRefSchema, domain.gitCheckoutRefSchema],
    [
      "workspace resolution failure",
      workspaceResolutionFailureSchema,
      coreResolutionFailureSchema,
    ],
  ] as const)("keeps the %s identical to core's", (_, copy, core) => {
    expect(z.toJSONSchema(copy)).toEqual(z.toJSONSchema(core));
  });

  it("keeps the branch list limits identical to core's", () => {
    expect({ BRANCH_LIST_LIMIT_MAX, BRANCH_LIST_QUERY_MAX_LENGTH }).toEqual({
      BRANCH_LIST_LIMIT_MAX: domain.BRANCH_LIST_LIMIT_MAX,
      BRANCH_LIST_QUERY_MAX_LENGTH: domain.BRANCH_LIST_QUERY_MAX_LENGTH,
    });
  });
});
