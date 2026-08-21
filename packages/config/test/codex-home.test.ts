import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCodexHome } from "../src/codex-home.js";

describe("resolveCodexHome", () => {
  it("defaults to the .codex directory under the supplied home", () => {
    expect(resolveCodexHome("/Users/tester", {})).toBe(
      path.join("/Users/tester", ".codex"),
    );
  });

  it("uses a nonblank CODEX_HOME value", () => {
    expect(
      resolveCodexHome("/Users/tester", {
        CODEX_HOME: " /custom/codex-home ",
      }),
    ).toBe("/custom/codex-home");
  });
});
