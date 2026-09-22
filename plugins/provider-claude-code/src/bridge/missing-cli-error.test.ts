import { describe, expect, it } from "vitest";
import {
  MissingClaudeCliError,
  translateMissingClaudeCliCatalogError,
  translateMissingClaudeCliError,
} from "./missing-cli-error.js";

const MISSING_CLI = new Error(
  "Native CLI binary for darwin-arm64 not found at /tmp/cli",
);

describe("missing Claude CLI errors", () => {
  it("marks a catalog probe failure so model/list can answer with the missing-executable code", () => {
    const translated = translateMissingClaudeCliCatalogError(MISSING_CLI);

    expect(translated).toBeInstanceOf(MissingClaudeCliError);
    expect((translated as Error).message).toContain(
      "could not find the Claude Code CLI",
    );
    expect((translated as Error).cause).toBe(MISSING_CLI);
  });

  it("leaves unrelated failures and the session path unmarked", () => {
    const unrelated = new Error("Session closed");

    expect(translateMissingClaudeCliCatalogError(unrelated)).toBe(unrelated);
    expect(translateMissingClaudeCliError(MISSING_CLI)).not.toBeInstanceOf(
      MissingClaudeCliError,
    );
  });
});
