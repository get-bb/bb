import type { ProjectSource } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolvePluginBranchHostId } from "./usePluginBranchPickerState";

function source(hostId: string, isDefault: boolean): ProjectSource {
  return {
    id: `source-${hostId}`,
    projectId: "project-1",
    type: "local_path",
    hostId,
    path: `/repo/${hostId}`,
    isDefault,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("resolvePluginBranchHostId", () => {
  it.each([
    {
      name: "keeps an explicit host",
      hostId: "host-1",
      sources: [source("source-host", true)],
      expected: "host-1",
    },
    {
      name: "uses the default project source before a host exists",
      hostId: null,
      sources: [source("other-host", false), source("source-host", true)],
      expected: "source-host",
    },
    {
      name: "falls back to the first local source without a default",
      hostId: null,
      sources: [source("first-host", false), source("second-host", false)],
      expected: "first-host",
    },
    {
      name: "has no host without sources",
      hostId: null,
      sources: undefined,
      expected: null,
    },
  ])("$name", ({ hostId, sources, expected }) => {
    expect(resolvePluginBranchHostId(hostId, sources)).toBe(expected);
  });
});
