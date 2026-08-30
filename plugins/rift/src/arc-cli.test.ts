import { describe, expect, it } from "vitest";
import {
  ARC_CLI_COMMANDS,
  arcCreateInput,
  arcRouting,
  parseArcCliInvocation,
  safeCliField,
  safeCliJson,
} from "./arc-cli.js";

describe("Arc CLI parsing", () => {
  it("maps every Arc create field without dropping routing", () => {
    const parsed = parseArcCliInvocation([
      "create",
      "--provider=acp-rift-testing",
      "--host=host_1",
      "--id=arc_1",
      "--backend=apple-container",
      "--remote-provider=machines",
      "--size=a1.medium",
      "--thread=thread_1",
      "--project=project_1",
      "--repository-url=https://example.com/repository.git",
      '--portals=[{"name":"web","url":"https://arc.example.com"}]',
      "--workspace-root=/workspace",
      "--name=Build Arc",
      "--image=rift-local-arc:1.0.0",
    ]);
    if (parsed === null) throw new Error("expected a parsed Arc command");

    const routing = arcRouting(parsed.options, { cwd: "/checkout" });
    expect(arcCreateInput(parsed.options, routing)).toEqual({
      providerId: "acp-rift-testing",
      hostId: "host_1",
      cwd: "/checkout",
      arcId: "arc_1",
      backend: "apple-container",
      provider: "machines",
      size: "a1.medium",
      threadId: "thread_1",
      projectId: "project_1",
      repositoryUrl: "https://example.com/repository.git",
      portals: [{ name: "web", url: "https://arc.example.com" }],
      workspaceRoot: "/workspace",
      displayName: "Build Arc",
      image: "rift-local-arc:1.0.0",
    });
  });

  it("rejects unknown flags for every Arc subcommand", () => {
    for (const command of ARC_CLI_COMMANDS) {
      expect(() =>
        parseArcCliInvocation([command, "--unconsumed=value"]),
      ).toThrow(`unknown flag --unconsumed for bb arc ${command}`);
    }
  });

  it("rejects duplicate flags and ambiguous routing", () => {
    expect(() =>
      parseArcCliInvocation(["list", "--host=one", "--host=two"]),
    ).toThrow("duplicate flag --host");
    const parsed = parseArcCliInvocation([
      "list",
      "--host=host_1",
      "--environment=environment_1",
    ]);
    if (parsed === null) throw new Error("expected a parsed Arc command");
    expect(() => arcRouting(parsed.options, {})).toThrow(
      "--host and --environment are mutually exclusive",
    );
  });

  it("rejects malformed portal JSON before invoking the provider", () => {
    const parsed = parseArcCliInvocation([
      "create",
      "--portals=not-json",
    ]);
    if (parsed === null) throw new Error("expected a parsed Arc command");
    expect(() =>
      arcCreateInput(parsed.options, arcRouting(parsed.options, {})),
    ).toThrow("--portals must be a JSON array");
  });
});

describe("Arc CLI terminal safety", () => {
  it("neutralizes terminal and bidi controls in human fields", () => {
    expect(safeCliField("arc\u001b[31m\tname\u202e")).toBe(
      "arc�[31m�name�",
    );
  });

  it("escapes terminal and bidi controls without corrupting JSON", () => {
    const text = safeCliJson(
      { displayName: "arc\u009b31m\u202e", status: "ready" },
      false,
    );
    expect(text).toBe(
      '{"displayName":"arc\\u009b31m\\u202e","status":"ready"}',
    );
    expect(JSON.parse(text)).toEqual({
      displayName: "arc\u009b31m\u202e",
      status: "ready",
    });
  });
});
