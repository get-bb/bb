import type {
  ExperimentalFixedTabTargetContract,
  JsonValue,
} from "@get-bb/plugin-sdk";
import { gitDiffTabTargetSchema, type GitDiffTabTarget } from "../contract.js";

export const gitDiffTabTarget: ExperimentalFixedTabTargetContract<GitDiffTabTarget> =
  {
    validate(value: JsonValue): value is GitDiffTabTarget {
      return gitDiffTabTargetSchema.safeParse(value).success;
    },
  };

export const GIT_DIFF_TAB_REFERENCE = {
  id: "diff",
  context: { kind: "thread" },
  availability: "fixed",
  experimental_target: gitDiffTabTarget,
} as const;
