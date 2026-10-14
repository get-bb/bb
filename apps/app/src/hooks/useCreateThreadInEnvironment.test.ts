import { describe, expect, it } from "vitest";
import {
  hasSingleUseRootComposeTargetState,
  readRootComposeEnvironmentTargetFromLocationState,
  shouldStartComposingFromLocationState,
} from "@/views/RootComposeView";
import { readThreadCreationPlacement } from "@/lib/thread-creation-placement";
import { buildCreateThreadInEnvironmentState } from "./useCreateThreadInEnvironment";

describe("buildCreateThreadInEnvironmentState", () => {
  it.each(["sec_a", null])(
    "opens the composer in the source environment and section %s",
    (sectionId) => {
      const state = buildCreateThreadInEnvironmentState({
        environmentId: "env_1",
        sectionId,
        pinned: true,
      });

      expect(readRootComposeEnvironmentTargetFromLocationState(state)).toEqual({
        kind: "reuse",
        environmentId: "env_1",
      });
      expect(readThreadCreationPlacement(state)).toEqual({
        sectionId,
        pinned: true,
      });
      expect(shouldStartComposingFromLocationState(state)).toBe(true);
      expect(hasSingleUseRootComposeTargetState(state)).toBe(true);
    },
  );
});
