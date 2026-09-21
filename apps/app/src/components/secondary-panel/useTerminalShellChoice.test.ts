import { describe, expect, it } from "vitest";
import type { TerminalShellOption } from "@bb/domain";
import { resolveTerminalShellSelection } from "./useTerminalShellChoice";

const pwsh: TerminalShellOption = {
  id: "pwsh",
  isDefault: true,
  label: "PowerShell 7",
  path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
};

const gitBash: TerminalShellOption = {
  id: "git-bash",
  isDefault: false,
  label: "Git Bash",
  path: "C:\\Program Files\\Git\\bin\\bash.exe",
};

describe("resolveTerminalShellSelection", () => {
  it("leaves launching to the host while the preference is automatic", () => {
    expect(
      resolveTerminalShellSelection({
        preferredShellId: "__automatic__",
        shells: [pwsh, gitBash],
      }),
    ).toEqual({
      defaultShell: pwsh,
      selectedShellId: "__automatic__",
      shellIdForLaunch: null,
    });
  });

  it("launches the picked shell when the host still offers it", () => {
    expect(
      resolveTerminalShellSelection({
        preferredShellId: "git-bash",
        shells: [pwsh, gitBash],
      }),
    ).toEqual({
      defaultShell: pwsh,
      selectedShellId: "git-bash",
      shellIdForLaunch: "git-bash",
    });
  });

  it("keeps the host default for a shell this host does not have", () => {
    expect(
      resolveTerminalShellSelection({
        preferredShellId: "git-bash",
        shells: [pwsh],
      }),
    ).toEqual({
      defaultShell: pwsh,
      selectedShellId: "__automatic__",
      shellIdForLaunch: null,
    });
  });

  it("reports no choice on a host without a shell list", () => {
    expect(
      resolveTerminalShellSelection({
        preferredShellId: "pwsh",
        shells: [],
      }),
    ).toEqual({
      defaultShell: null,
      selectedShellId: "__automatic__",
      shellIdForLaunch: null,
    });
  });
});
