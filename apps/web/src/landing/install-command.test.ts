import { describe, expect, it } from "vitest";

import { installCommandForPage } from "./install-command";
import { CLI_COMMAND } from "./site";

describe("installCommandForPage", () => {
  it("tags the install command with an approved ad campaign", () => {
    expect(
      installCommandForPage(
        "?utm_source=google&utm_campaign=codex-oct26&gclid=abc",
        "macos",
      ),
    ).toBe("BB_INSTALL_CAMPAIGN=codex-oct26 npx bb-app@latest");
    expect(installCommandForPage("?utm_campaign=extend-oct26", "linux")).toBe(
      "BB_INSTALL_CAMPAIGN=extend-oct26 npx bb-app@latest",
    );
  });

  it.each([
    "?utm_campaign=3f2b8c1e-9d4a-4b7e-a1c2-5e6f7a8b9c0d",
    "?utm_campaign=mods",
  ])("keeps the plain command for an unapproved campaign in %s", (search) => {
    expect(installCommandForPage(search, "macos")).toBe(CLI_COMMAND);
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
    expect(installCommandForPage("?utm_campaign=codex-oct26", "windows")).toBe(
      CLI_COMMAND,
    );
    expect(installCommandForPage("?utm_campaign=codex-oct26", null)).toBe(
      CLI_COMMAND,
    );
  });
});
