import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { shouldOpenPathEntryDialog } from "./useLocalPathPicker";

const atum = makeHost({ id: "host_atum", name: "atum" });

function host(
  id: string,
  name: string,
  status: Host["status"] = "connected",
): Host {
  return makeHost({ ...atum, id, name, status });
}

describe("shouldOpenPathEntryDialog", () => {
  it.each<[string, Host[] | undefined, boolean, boolean]>([
    [
      "keeps the native picker with only the local machine",
      [atum],
      false,
      false,
    ],
    [
      "opens the dialog when several machines are connected",
      [atum, host("host_thoth", "Thoth")],
      false,
      true,
    ],
    [
      "keeps the native picker when the only other machine is offline",
      [atum, host("host_dead", "Old laptop", "disconnected")],
      false,
      false,
    ],
    [
      "opens the dialog when the other connected machine came from a provider",
      [
        atum,
        makeHost({ id: "host_sandbox", name: "Sandbox", status: "connected" }),
      ],
      false,
      true,
    ],
    [
      "opens the dialog while the machine list is still loading",
      undefined,
      true,
      true,
    ],
  ])("%s", (_label, hosts, isLoadingHosts, expected) => {
    expect(shouldOpenPathEntryDialog(hosts, isLoadingHosts)).toBe(expected);
  });
});
