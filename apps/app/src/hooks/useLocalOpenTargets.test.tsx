// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useLocalOpenTargets } from "./useLocalOpenTargets";

afterEach(() => {
  cleanup();
});

const contextCases: Array<{
  createContext: () => OpenInTargetContext;
  kind: OpenInTargetContext["kind"];
}> = [
  {
    kind: "local",
    createContext: () => ({ kind: "local" }),
  },
  {
    kind: "remote-ssh",
    createContext: () => ({
      kind: "remote-ssh",
      hostId: "host-1",
      serverOrigin: "https://bb.example.test",
    }),
  },
];

describe("useLocalOpenTargets", () => {
  it.each(contextCases)(
    "keeps file-open callbacks stable for equal $kind contexts",
    ({ createContext }) => {
      const { wrapper } = createQueryClientTestHarness();
      const { result, rerender } = renderHook(
        () =>
          useLocalOpenTargets({
            enabled: false,
            openContext: createContext(),
          }),
        { wrapper },
      );
      const initialOpenPathInFileTarget = result.current.openPathInFileTarget;

      rerender();

      expect(result.current.openPathInFileTarget).toBe(
        initialOpenPathInFileTarget,
      );
    },
  );
});
