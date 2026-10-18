// @vitest-environment jsdom
/// <reference types="vitest/jsdom" />

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  systemCliCommandQueryKey,
  systemConfigQueryKey,
} from "@/hooks/queries/query-keys";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSettingsSearchConditions } from "./useSettingsSearchConditions";

const LOCAL_URL = "http://localhost:3000/";

function renderConditions(args: {
  cliCommandSupported: boolean;
  performanceDiagnosticsAvailable: boolean;
}): string[] {
  const { queryClient, wrapper } = createQueryClientTestHarness({
    queries: { staleTime: Infinity },
  });
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      performanceDiagnosticsAvailable: args.performanceDiagnosticsAvailable,
    }),
  );
  queryClient.setQueryData(systemCliCommandQueryKey(), {
    installedPath: null,
    onPath: false,
    shadowedBy: null,
    supported: args.cliCommandSupported,
  });
  const { result } = renderHook(() => useSettingsSearchConditions(), {
    wrapper,
  });
  return [...result.current].sort();
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  jsdom.reconfigure({ url: LOCAL_URL });
});

describe("useSettingsSearchConditions", () => {
  it("meets no condition in a plain browser on localhost without plugins", () => {
    jsdom.reconfigure({ url: LOCAL_URL });

    expect(
      renderConditions({
        cliCommandSupported: false,
        performanceDiagnosticsAvailable: false,
      }),
    ).toEqual([]);
  });

  it("meets the conditions the server, the address, and plugins satisfy", () => {
    jsdom.reconfigure({ url: "http://192.168.1.20:3000/" });
    setPluginSlotRegistrations(
      "inkwell",
      makePluginRegistrationSet({
        threadLists: [{ id: "inbox", title: "Inbox", component: () => null }],
        sourceCodeRenderers: [
          { id: "source", title: "Inkwell source", component: () => null },
        ],
        diffRenderers: [
          { id: "diffs", title: "Inkwell diffs", component: () => null },
        ],
        fileOpeners: [
          {
            id: "editor",
            title: "Inkwell editor",
            extensions: ["md"],
            component: () => null,
          },
        ],
      }),
    );

    expect(
      renderConditions({
        cliCommandSupported: true,
        performanceDiagnosticsAvailable: true,
      }),
    ).toEqual([
      "cliCommand",
      "diffRenderers",
      "fileOpeners",
      "localhostLinkRewrite",
      "performanceDiagnostics",
      "sourceCodeRenderers",
      "threadLists",
    ]);
  });
});
