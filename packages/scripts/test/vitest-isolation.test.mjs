import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { partitionTestFiles } from "../../../vitest.shared.ts";

it("isolates clock mutations in tests and imported helpers", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-vitest-isolation-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "test"));
  const fixtures = {
    "plain.test.ts": 'import { it } from "vitest"; it("plain", () => {});',
    "timers.test.ts": "vi.useFakeTimers();",
    "date.test.ts": "vi.setSystemTime(new Date());",
    "helper.test.ts": 'import "./clock-helper.js";',
    "clock-helper.ts": "vi.useFakeTimers({ toFake: ['Date'] });",
  };
  for (const [name, source] of Object.entries(fixtures)) {
    writeFileSync(join(root, "test", name), source);
  }

  expect(partitionTestFiles(root, ["test"])).toEqual({
    shared: [{ environment: null, files: ["test/plain.test.ts"] }],
    isolated: ["test/date.test.ts", "test/helper.test.ts", "test/timers.test.ts"],
  });
});
