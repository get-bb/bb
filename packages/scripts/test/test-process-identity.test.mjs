import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findProcessIdentityChecks,
  isTestSource,
} from "../../../scripts/check-test-process-identity.mjs";

const cases = JSON.parse(
  readFileSync(
    new URL("./test-process-identity-cases.json", import.meta.url),
    "utf8",
  ),
);

const rulesIn = (source) =>
  [
    ...new Set(
      findProcessIdentityChecks(source).map((finding) => finding.rule),
    ),
  ].sort();

describe("findProcessIdentityChecks on checks that past fixes removed", () => {
  it.each(
    cases.rejected.map(({ name, source, rules }) => [name, source, rules]),
  )("finds the %s", (_name, source, rules) => {
    expect(rulesIn(source)).toEqual(rules);
  });
});

describe("findProcessIdentityChecks on handle-based checks", () => {
  it.each(cases.accepted.map(({ name, source }) => [name, source]))(
    "accepts %s",
    (_name, source) => {
      expect(rulesIn(source)).toEqual([]);
    },
  );

  it("reports the line of each finding", () => {
    expect(findProcessIdentityChecks(cases.lineReport.source)).toMatchObject([
      { line: cases.lineReport.line, rule: cases.lineReport.rule },
    ]);
  });
});

describe("isTestSource", () => {
  it.each([
    "apps/server/test/app/install-machine-script.test.ts",
    "packages/agent-runtime/src/runtime.process-lifecycle.test.ts",
    "plugins/provider-codex/src/bridge/bridge-process.test-support.ts",
    "packages/plugin-sdk/src/testing/fake-plugin-host.ts",
    "packages/test-helpers/src/process-sweep.ts",
    "apps/host-daemon/src/server-move/test-fixture.ts",
    "tests/integration/global-setup.ts",
    "tests/qa/src/shared.ts",
    "packages/scripts/test/start-bb.test.mjs",
  ])("treats %s as test code", (path) => {
    expect(isTestSource(path)).toBe(true);
  });

  it.each([
    "packages/config/src/verified-process-stop.ts",
    "apps/host-daemon/src/server-move/pending-server.ts",
    "packages/scripts/src/lib/pid-file.ts",
    "docs/debugging-and-qa.md",
  ])("leaves production file %s alone", (path) => {
    expect(isTestSource(path)).toBe(false);
  });
});
