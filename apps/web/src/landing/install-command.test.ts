import { describe, expect, it } from "vitest";

import { installCommandForPage } from "./install-command";
import { CLI_COMMAND } from "./site";

describe("installCommandForPage", () => {
  it("tags the install command with a valid ad campaign slug", () => {
    expect(
      installCommandForPage(
        "?utm_source=google&utm_campaign=claude-code-alt&gclid=abc",
        "macos",
      ),
    ).toBe("BB_INSTALL_CAMPAIGN=claude-code-alt npx bb-app@latest");
    expect(installCommandForPage("?utm_campaign=mods", "linux")).toBe(
      "BB_INSTALL_CAMPAIGN=mods npx bb-app@latest",
    );
  });

  it.each([
    "?utm_campaign=Brand%20Search",
    "?utm_campaign=-leading",
    "?utm_campaign=a;rm%20-rf",
    `?utm_campaign=${"a".repeat(41)}`,
    "?utm_campaign=",
  ])("keeps the plain command for an invalid slug in %s", (search) => {
    expect(installCommandForPage(search, "macos")).toBe(CLI_COMMAND);
  });

  it("keeps the plain command without a campaign param", () => {
    expect(installCommandForPage("", "macos")).toBe(CLI_COMMAND);
    expect(installCommandForPage("?utm_source=google", "linux")).toBe(
      CLI_COMMAND,
    );
  });

  it("keeps the plain command where the shell cannot prefix env vars", () => {
    expect(installCommandForPage("?utm_campaign=mods", "windows")).toBe(
      CLI_COMMAND,
    );
    expect(installCommandForPage("?utm_campaign=mods", null)).toBe(
      CLI_COMMAND,
    );
  });
});
