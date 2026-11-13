import { describe, expect, it } from "vitest";
import { classifyProviderCliInstallFailure } from "./provider-cli-install-failure";

function exited(exitCode: number | null) {
  return { exitCode, signal: exitCode === null ? "SIGKILL" : null };
}

describe("classifyProviderCliInstallFailure", () => {
  it.each([
    {
      name: "missing installer command",
      completed: null,
      errorMessage: "Command not found: npm",
      output: "$ npm install -g @openai/codex@latest\n",
      expected: { detail: "not_found" },
    },
    {
      name: "another install already running",
      completed: null,
      errorMessage: "Provider installation already running for claude-code",
      output: "",
      expected: { detail: "in_progress" },
    },
    {
      name: "install no longer offered",
      completed: null,
      errorMessage: "Codex install is no longer available on this host.",
      output: "",
      expected: { detail: "unavailable" },
    },
    {
      name: "exit 0 that failed verification",
      completed: exited(0),
      errorMessage:
        "codex update exited successfully, but the provider could not verify the installed result.",
      output: "changed 1 package in 3s\n",
      expected: { detail: "verification_failed", exitCode: 0 },
    },
    {
      name: "npm global prefix not writable",
      completed: exited(243),
      errorMessage: null,
      output:
        "npm error code EACCES\nnpm error syscall mkdir\nnpm error path /usr/local/lib/node_modules/@openai\n",
      expected: { detail: "permission", exitCode: 243 },
    },
    {
      name: "npm offline",
      completed: exited(1),
      errorMessage: null,
      output:
        "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@openai%2fcodex failed\n",
      expected: { detail: "network", exitCode: 1 },
    },
    {
      name: "curl cannot resolve the installer host",
      completed: exited(6),
      errorMessage: null,
      output: "curl: (6) Could not resolve host: claude.ai\n",
      expected: { detail: "network", exitCode: 6 },
    },
    {
      name: "disk full",
      completed: exited(1),
      errorMessage: null,
      output: "npm error code ENOSPC\nnpm error no space left on device\n",
      expected: { detail: "disk_full", exitCode: 1 },
    },
    {
      name: "other npm failure",
      completed: exited(1),
      errorMessage: null,
      output: "npm error code E404\nnpm error 404 Not Found\n",
      expected: { detail: "npm_error", exitCode: 1 },
    },
    {
      name: "shell could not find a command",
      completed: exited(127),
      errorMessage: null,
      output: "sh: 1: curl: not found\n",
      expected: { detail: "not_found", exitCode: 127 },
    },
    {
      name: "killed by a signal",
      completed: exited(null),
      errorMessage: null,
      output: "Downloading...\n",
      expected: { detail: "signal" },
    },
    {
      name: "unrecognized non-zero exit",
      completed: exited(3),
      errorMessage: null,
      output: "Something went wrong\n",
      expected: { detail: "exit_nonzero", exitCode: 3 },
    },
    {
      name: "no completion and an unrecognized error",
      completed: null,
      errorMessage: "posix_spawnp failed.",
      output: "",
      expected: { detail: "other" },
    },
  ])("classifies $name", ({ completed, errorMessage, output, expected }) => {
    expect(
      classifyProviderCliInstallFailure({ completed, errorMessage, output }),
    ).toEqual(expected);
  });

  it.each([
    { code: "E404", expected: "npm_error" },
    { code: "EACCES", expected: "permission" },
  ])(
    "classifies colored npm $code output from the terminal",
    ({ code, expected }) => {
      expect(
        classifyProviderCliInstallFailure({
          completed: exited(1),
          errorMessage: null,
          output: `\x1b[1mnpm\x1b[22m \x1b[31merror\x1b[39m code ${code}\r\n`,
        }),
      ).toEqual({ detail: expected, exitCode: 1 });
    },
  );

  it("does not match patterns from the echoed command line", () => {
    expect(
      classifyProviderCliInstallFailure({
        completed: exited(2),
        errorMessage: null,
        output:
          '$ tmp=$(mktemp "${TMPDIR:-/tmp}/provider-installation.XXXXXX") && curl -fsSL https://claude.ai/install.sh -o "$tmp" && bash "$tmp"\n',
      }),
    ).toEqual({ detail: "exit_nonzero", exitCode: 2 });
  });
});
