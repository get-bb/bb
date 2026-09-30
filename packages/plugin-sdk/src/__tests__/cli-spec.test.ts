import { describe, expect, it, vi } from "vitest";
import type { PluginCliRegistration, PluginCliResult } from "../index.js";
import { PluginCliError, cliCommand, defineCli } from "../index.js";

function run(
  registration: PluginCliRegistration,
  argv: string[],
): Promise<PluginCliResult> {
  return Promise.resolve(registration.run(argv, {}));
}

const ran = vi.fn();

function memoryLikeCli(): PluginCliRegistration {
  ran.mockClear();
  return defineCli({
    name: "memory",
    summary: "Read and maintain durable memories",
    commands: {
      catalog: cliCommand({
        summary: "List compact memory summaries",
        aliases: ["list"],
        options: {
          scope: {
            type: "enum",
            values: ["all", "project", "global"],
            default: "all",
            description: "Which memories to read",
          },
          limit: {
            type: "integer",
            min: 1,
            max: 100,
            default: 20,
            description: "How many memories to return",
          },
          json: { type: "boolean", description: "Emit JSON" },
        },
        run(input) {
          ran(input.options);
          return {
            exitCode: 0,
            stdout: `${input.options.scope}:${input.options.limit}`,
          };
        },
      }),
      search: cliCommand({
        summary: "Search memory summaries",
        positionals: [
          {
            name: "query",
            description: "Words to search for",
            required: true,
            variadic: true,
          },
        ],
        options: { json: { type: "boolean", description: "Emit JSON" } },
        run(input) {
          ran(input.positionals);
          return { exitCode: 0, stdout: input.positionals.query.join(" ") };
        },
      }),
      add: cliCommand({
        summary: "Save a project or global memory",
        unexpectedPositionalHint:
          "the memory text belongs in --details <TEXT>, not a bare argument",
        options: {
          scope: {
            type: "enum",
            values: ["project", "global"],
            required: true,
            description: "Where the memory lives",
          },
          name: {
            type: "string",
            required: true,
            placeholder: "NAME",
            aliases: ["title"],
            description: "Unique name, at most 80 characters",
          },
          summary: {
            type: "string",
            required: true,
            placeholder: "TEXT",
            description: "One line, at most 400 characters",
          },
          details: {
            type: "string",
            required: true,
            placeholder: "TEXT",
            aliases: ["body", "text", "content"],
            description: "Full text, at most 16000 characters",
          },
          tag: {
            type: "string",
            repeatable: true,
            split: ",",
            aliases: ["tags"],
            placeholder: "TAG",
            description: "Lowercase tag",
          },
          importance: {
            type: "integer",
            min: 0,
            max: 100,
            default: 50,
            description: "Ranking weight",
          },
          pinned: { type: "boolean", description: "Always inject" },
          json: { type: "boolean", description: "Emit JSON" },
        },
        run(input) {
          ran(input.options);
          return { exitCode: 0, stdout: "saved" };
        },
      }),
    },
  });
}

describe("defineCli help", () => {
  it("prints the command list at the top level and never runs a command", async () => {
    const cli = memoryLikeCli();
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      const result = await run(cli, argv);
      expect(result.exitCode, argv.join(" ")).toBe(0);
      expect(result.stdout).toContain("bb memory catalog");
      expect(result.stdout).toContain("List compact memory summaries");
      expect(result.stdout).toContain("bb memory add");
      expect(result.stderr).toBeUndefined();
    }
    expect(ran).not.toHaveBeenCalled();
  });

  it("documents a command's arguments, options, limits and defaults", async () => {
    const cli = memoryLikeCli();
    const result = await run(cli, ["add", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bb memory add --scope <project|global>");
    expect(result.stdout).toContain("--summary <TEXT>");
    expect(result.stdout).toContain("at most 400 characters (required)");
    expect(result.stdout).toContain("--tag <TAG>");
    expect(result.stdout).toContain("(repeatable)");
    expect(result.stdout).toContain("--importance <0-100>");
    expect(result.stdout).toContain("(default: 50)");
    expect(result.stdout).toContain("--help, -h");
    expect(ran).not.toHaveBeenCalled();
  });

  it("hides alias spellings from help while still accepting them", async () => {
    const cli = memoryLikeCli();
    const help = await run(cli, ["add", "-h"]);
    expect(help.stdout).not.toContain("--tags");
    expect(help.stdout).not.toContain("--title");

    const result = await run(cli, [
      "add",
      "--scope",
      "global",
      "--title",
      "a-name",
      "--summary",
      "s",
      "--body",
      "d",
      "--tags",
      "one,two",
      "--tag",
      "three",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(ran).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "a-name",
        details: "d",
        tag: ["one", "two", "three"],
      }),
    );
  });

  it("documents positional arguments", async () => {
    const result = await run(memoryLikeCli(), ["search", "--help"]);
    expect(result.stdout).toContain("bb memory search <query...>");
    expect(result.stdout).toContain("Words to search for (required)");
  });

  it("shows help with exit 1 when no command is named", async () => {
    const result = await run(memoryLikeCli(), []);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("bb memory catalog");
    expect(ran).not.toHaveBeenCalled();
  });
});

describe("defineCli errors", () => {
  it("names an unknown command, suggests the nearest, and lists commands", async () => {
    const result = await run(memoryLikeCli(), ["catlog"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command 'catlog'");
    expect(result.stderr).toContain("(Did you mean catalog?)");
    expect(result.stderr).toContain("bb memory search");
    expect(result.stdout).toBeUndefined();
  });

  it("suggests a declared near-miss name that is not close by spelling", async () => {
    const cli = defineCli({
      name: "connect",
      summary: "Remote access",
      commands: {
        shares: cliCommand({
          summary: "List shared ports",
          suggestFor: ["list", "ls"],
          run: () => ({ exitCode: 0 }),
        }),
      },
    });
    const result = await run(cli, ["list"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command 'list'");
    expect(result.stderr).toContain("(Did you mean shares?)");
  });

  it("runs a hidden command alias instead of failing", async () => {
    const cli = memoryLikeCli();
    const result = await run(cli, ["list"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("all:20");
  });

  it("rejects an unknown option with the nearest declared spelling", async () => {
    const result = await run(memoryLikeCli(), ["catalog", "--limits", "3"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown option '--limits'");
    expect(result.stderr).toContain("(Did you mean --limit?)");
    expect(result.stderr).toContain("Usage:\n  bb memory catalog");
    expect(ran).not.toHaveBeenCalled();
  });

  it("never silently ignores an unknown option", async () => {
    const result = await run(memoryLikeCli(), ["catalog", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown option '--bogus'");
    expect(result.stderr).not.toContain("Did you mean");
  });

  it("reports every missing required option in one error", async () => {
    const result = await run(memoryLikeCli(), ["add", "--scope", "global"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "missing required options: --name, --summary, --details",
    );
    expect(result.stderr).toContain("Usage:\n  bb memory add");
  });

  it("reports missing positionals together with missing options", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        move: cliCommand({
          summary: "Move",
          positionals: [
            { name: "from", description: "Source", required: true },
            { name: "to", description: "Target", required: true },
          ],
          options: {
            reason: { type: "string", required: true, description: "Why" },
          },
          run: () => ({ exitCode: 0 }),
        }),
      },
    });
    const result = await run(cli, ["move", "a"]);
    expect(result.stderr).toContain("missing required arguments: <to>");
    expect(result.stderr).toContain("missing required options: --reason");
  });

  it("rejects an unexpected positional with the command's own hint", async () => {
    const result = await run(memoryLikeCli(), [
      "add",
      "--scope",
      "global",
      "--name",
      "n",
      "--summary",
      "s",
      "--details",
      "d",
      "extra text",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unexpected argument 'extra text'");
    expect(result.stderr).toContain("belongs in --details");
    expect(ran).not.toHaveBeenCalled();
  });

  it("names the option, the value and the accepted values", async () => {
    const result = await run(memoryLikeCli(), [
      "catalog",
      "--scope",
      "readonly",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "invalid value 'readonly' for --scope. Expected one of: all, project, global",
    );
  });

  it("names the accepted range for an integer", async () => {
    const tooBig = await run(memoryLikeCli(), ["catalog", "--limit", "900"]);
    expect(tooBig.stderr).toContain(
      "invalid value '900' for --limit. Expected an integer between 1 and 100",
    );
    const notNumeric = await run(memoryLikeCli(), [
      "catalog",
      "--limit",
      "few",
    ]);
    expect(notNumeric.stderr).toContain("invalid value 'few' for --limit");
  });

  it("rejects a repeated option that takes a single value", async () => {
    const result = await run(memoryLikeCli(), [
      "catalog",
      "--limit",
      "5",
      "--limit",
      "6",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--limit was given more than once");
    expect(ran).not.toHaveBeenCalled();
  });

  it("rejects an option written without its value", async () => {
    const result = await run(memoryLikeCli(), ["catalog", "--limit"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--limit requires a value");
    expect(result.stderr).toContain("--limit=<value>");
  });

  it("exits with the spec's usage error code for every usage failure", async () => {
    const cli = defineCli({
      name: "retry",
      summary: "retry",
      usageErrorExitCode: 2,
      commands: {
        "queue cancel": cliCommand({
          summary: "Cancel",
          positionals: [{ name: "id", description: "Id", required: true }],
          options: { json: { type: "boolean", description: "Emit JSON" } },
          run: () => ({ exitCode: 0 }),
        }),
      },
    });

    for (const argv of [
      [],
      ["--json"],
      ["queue"],
      ["queue", "cancle"],
      ["queue", "cancel"],
      ["queue", "cancel", "a", "b"],
      ["queue", "cancel", "a", "--jsno"],
    ]) {
      const result = await run(cli, argv);
      expect(result.exitCode, argv.join(" ")).toBe(2);
    }
    await expect(run(cli, ["queue", "cancel", "a"])).resolves.toMatchObject({
      exitCode: 0,
    });
  });
});

describe("defineCli parsing", () => {
  it("accepts --flag=value, --flag value, and negative numbers", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        set: cliCommand({
          summary: "Set",
          options: {
            offset: {
              type: "integer",
              min: -10,
              max: 10,
              description: "Offset",
            },
            note: { type: "string", description: "Note" },
          },
          run(input) {
            return {
              exitCode: 0,
              stdout: `${input.options.offset}|${input.options.note}`,
            };
          },
        }),
      },
    });
    expect(
      (await run(cli, ["set", "--offset=-3", "--note=hi there"])).stdout,
    ).toBe("-3|hi there");
    expect((await run(cli, ["set", "--offset", "-3"])).stdout).toBe(
      "-3|undefined",
    );
  });

  it("takes a value that starts with a dash, such as a Markdown bullet", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        say: cliCommand({
          summary: "Say",
          options: {
            body: { type: "string", description: "Body" },
            title: { type: "string", aliases: ["name"], description: "Title" },
          },
          run(input) {
            return {
              exitCode: 0,
              stdout: `${input.options.body}|${input.options.title}`,
            };
          },
        }),
      },
    });
    expect(
      (await run(cli, ["say", "--body", "- first\n- second", "--title", "--x"]))
        .stdout,
    ).toBe("- first\n- second|--x");

    for (const forgotten of ["--title", "--name", "--"]) {
      const result = await run(cli, ["say", "--body", forgotten, "later"]);
      expect(result.exitCode, forgotten).toBe(1);
      expect(result.stderr, forgotten).toContain("--body requires a value");
    }
  });

  it("names the unknown word under a nested command and suggests its sibling", async () => {
    const leaf = (summary: string) =>
      cliCommand({
        summary,
        run: () => ({ exitCode: 0, stdout: summary }),
      });
    const cli = defineCli({
      name: "pool",
      summary: "pool",
      commands: {
        "account add": leaf("add"),
        "account list": leaf("list"),
        status: leaf("status"),
      },
    });

    const typo = await run(cli, ["account", "lst"]);
    expect(typo.exitCode).toBe(1);
    expect(typo.stderr).toContain("unknown command 'account lst'");
    expect(typo.stderr).toContain("Did you mean account list?");

    const incomplete = await run(cli, ["account"]);
    expect(incomplete.exitCode).toBe(1);
    expect(incomplete.stderr).toContain("missing command after 'account'");
    expect(incomplete.stderr).toContain("Expected one of: add, list");

    const topLevel = await run(cli, ["statsu"]);
    expect(topLevel.stderr).toContain("unknown command 'statsu'");
    expect(topLevel.stderr).toContain("Did you mean status?");
  });

  it("marks its registration as rendering its own help", () => {
    expect(memoryLikeCli().rendersHelp).toBe(true);
  });

  it("stops option parsing at -- and keeps the rest", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        exec: cliCommand({
          summary: "Exec",
          passthrough: true,
          positionals: [{ name: "id", description: "Id", required: true }],
          options: { json: { type: "boolean", description: "JSON" } },
          run(input) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(input.passthrough),
            };
          },
        }),
        echo: cliCommand({
          summary: "Echo",
          positionals: [
            { name: "words", description: "Words", variadic: true },
          ],
          run(input) {
            return { exitCode: 0, stdout: input.positionals.words.join("|") };
          },
        }),
      },
    });
    const passthrough = await run(cli, [
      "exec",
      "abc",
      "--json",
      "--",
      "ls",
      "--all",
    ]);
    expect(passthrough.stdout).toBe(JSON.stringify(["ls", "--all"]));

    const positional = await run(cli, ["echo", "--", "--all", "x"]);
    expect(positional.stdout).toBe("--all|x");
  });

  it("parses booleans without swallowing the next token", async () => {
    const cli = memoryLikeCli();
    const result = await run(cli, [
      "add",
      "--pinned",
      "--scope",
      "global",
      "--name",
      "n",
      "--summary",
      "s",
      "--details",
      "d",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(ran).toHaveBeenCalledWith(
      expect.objectContaining({ pinned: true, scope: "global" }),
    );
  });

  it("accepts explicit boolean values and rejects other spellings", async () => {
    const cli = memoryLikeCli();
    const off = await run(cli, ["catalog", "--json=false"]);
    expect(off.exitCode, off.stderr).toBe(0);
    expect(ran).toHaveBeenCalledWith(expect.objectContaining({ json: false }));
    const bad = await run(cli, ["catalog", "--json=maybe"]);
    expect(bad.stderr).toContain(
      "invalid value 'maybe' for --json. Expected one of: true, false",
    );
  });

  it("supports short options", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        show: cliCommand({
          summary: "Show",
          options: {
            format: {
              type: "enum",
              values: ["text", "json"],
              short: "f",
              default: "text",
              description: "Output format",
            },
          },
          run: (input) => ({ exitCode: 0, stdout: input.options.format }),
        }),
      },
    });
    expect((await run(cli, ["show", "-f", "json"])).stdout).toBe("json");
    expect((await run(cli, ["show", "-x"])).stderr).toContain(
      "unknown option '-x'",
    );
  });

  it("resolves nested command paths and exposes them as metadata", async () => {
    const cli = defineCli({
      name: "pool",
      summary: "Account pool",
      commands: {
        "account add": cliCommand({
          summary: "Add an account",
          options: {
            provider: {
              type: "enum",
              values: ["claude", "codex"],
              required: true,
              description: "Provider",
            },
            "api-key": {
              type: "string",
              stdin: true,
              description: "API key",
            },
          },
          run: (input) => ({ exitCode: 0, stdout: input.options.provider }),
        }),
        "account list": cliCommand({
          summary: "List accounts",
          run: () => ({ exitCode: 0, stdout: "listed" }),
        }),
      },
    });
    expect(
      (await run(cli, ["account", "add", "--provider", "codex"])).stdout,
    ).toBe("codex");
    expect((await run(cli, ["account", "list"])).stdout).toBe("listed");
    expect(cli.commands).toEqual([
      {
        name: "account-add",
        summary: "Add an account",
        usage:
          "bb pool account add --provider <claude|codex> [--api-key <value>]",
      },
      {
        name: "account-list",
        summary: "List accounts",
        usage: "bb pool account list",
      },
    ]);
    const help = await run(cli, ["account", "add", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("bb pool account add");

    const stdin = await run(cli, ["account", "add", "--api-key-stdin"]);
    expect(stdin.exitCode).toBe(1);
    expect(stdin.stderr).toContain("--api-key-stdin is read by the bb CLI");
  });

  it("runs a root command when no command word is given", async () => {
    const pair = vi.fn();
    const cli = defineCli({
      name: "connect",
      summary: "Remote access",
      description: "Pair from https://getbb.app",
      root: cliCommand({
        summary: "Pair this bb",
        options: {
          code: { type: "string", description: "Pairing code" },
          json: { type: "boolean", description: "Emit JSON" },
        },
        run(input) {
          if (input.options.code === undefined) {
            return { exitCode: 0, stdout: input.help };
          }
          pair(input.options.code);
          return { exitCode: 0, stdout: "paired" };
        },
      }),
      commands: {
        status: cliCommand({
          summary: "Show status",
          run: () => ({ exitCode: 0, stdout: "status" }),
        }),
      },
    });
    const bare = await run(cli, []);
    expect(bare.exitCode).toBe(0);
    expect(bare.stdout).toContain("Pair from https://getbb.app");
    expect(bare.stdout).toContain("bb connect status");
    expect(bare.stdout).toContain("--code <value>");

    expect((await run(cli, ["--code", "ABCD"])).stdout).toBe("paired");
    expect(pair).toHaveBeenCalledWith("ABCD");
    expect((await run(cli, ["bogus"])).stderr).toContain(
      "unknown command 'bogus'",
    );
    expect(cli.commands).toEqual([
      { name: "status", summary: "Show status", usage: "bb connect status" },
    ]);
  });
});

describe("defineCli durations", () => {
  const cli = defineCli({
    name: "demo",
    summary: "demo",
    commands: {
      wait: cliCommand({
        summary: "Wait",
        options: {
          timeout: {
            type: "duration",
            defaultUnit: "s",
            bareUnits: ["s", "ms"],
            min: 1000,
            max: 120_000,
            description: "How long to wait",
          },
          idle: {
            type: "duration",
            defaultUnit: "m",
            description: "Idle window",
          },
        },
        run: (input) => ({
          exitCode: 0,
          stdout: `${input.options.timeout}/${input.options.idle}`,
        }),
      }),
    },
  });

  it("parses every unit into milliseconds", async () => {
    expect((await run(cli, ["wait", "--timeout", "90s"])).stdout).toBe(
      "90000/undefined",
    );
    expect((await run(cli, ["wait", "--timeout", "2m"])).stdout).toBe(
      "120000/undefined",
    );
    expect((await run(cli, ["wait", "--timeout", "1500ms"])).stdout).toBe(
      "1500/undefined",
    );
    expect((await run(cli, ["wait", "--idle", "2h"])).stdout).toBe(
      "undefined/7200000",
    );
  });

  it("uses the declared default unit for a bare number", async () => {
    expect((await run(cli, ["wait", "--idle", "5"])).stdout).toBe(
      "undefined/300000",
    );
  });

  it("resolves a bare number by which declared range it lands in", async () => {
    expect((await run(cli, ["wait", "--timeout", "90"])).stdout).toBe(
      "90000/undefined",
    );
    expect((await run(cli, ["wait", "--timeout", "1500"])).stdout).toBe(
      "1500/undefined",
    );
  });

  it("rejects a bare number between the two ranges and names both forms", async () => {
    const result = await run(cli, ["wait", "--timeout", "500"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid value '500' for --timeout");
    expect(result.stderr).toContain("a duration with a unit (1500ms, 90s");
    expect(result.stderr).toContain("a bare number of seconds (1-120)");
    expect(result.stderr).toContain(
      "a bare number of milliseconds (1000-120000)",
    );
  });

  it("rejects an out-of-range duration that carries a unit", async () => {
    const result = await run(cli, ["wait", "--timeout", "10m"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid value '10m' for --timeout");
  });

  it("rejects a value the grammar does not match", async () => {
    expect((await run(cli, ["wait", "--timeout", "soon"])).stderr).toContain(
      "invalid value 'soon' for --timeout",
    );
  });
});

describe("defineCli constraints", () => {
  const cli = defineCli({
    name: "demo",
    summary: "demo",
    commands: {
      post: cliCommand({
        summary: "Post",
        options: {
          body: { type: "string", description: "Body text" },
          "body-file": { type: "string", description: "Body file" },
          host: { type: "string", description: "Host id" },
          draft: { type: "boolean", description: "Draft" },
        },
        constraints: [
          { kind: "exactly-one", options: ["body", "body-file"] },
          { kind: "requires", option: "body-file", needs: ["host"] },
        ],
        run: () => ({ exitCode: 0, stdout: "posted" }),
      }),
    },
  });

  it("requires exactly one of a group", async () => {
    const neither = await run(cli, ["post"]);
    expect(neither.stderr).toContain(
      "missing required options: one of --body, --body-file",
    );
    const both = await run(cli, [
      "post",
      "--body",
      "a",
      "--body-file",
      "b",
      "--host",
      "h",
    ]);
    expect(both.stderr).toContain("--body and --body-file cannot be combined");
    expect((await run(cli, ["post", "--body", "a"])).stdout).toBe("posted");
  });

  it("enforces an option that requires another", async () => {
    const result = await run(cli, ["post", "--body-file", "b"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--body-file requires --host");
  });

  it("documents the rules in help", async () => {
    const help = await run(cli, ["post", "--help"]);
    expect(help.stdout).toContain("Exactly one of:");
    expect(help.stdout).toContain("--body, --body-file");
    expect(help.stdout).toContain("requires --host");
  });
});

describe("defineCli json failures", () => {
  it("writes the envelope on stdout and keeps the text on stderr", async () => {
    const result = await run(memoryLikeCli(), [
      "add",
      "--json",
      "--scope",
      "global",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "missing_required",
        message: "missing required options: --name, --summary, --details",
        hint: expect.stringContaining("bb memory add"),
      },
    });
    expect(result.stderr).toContain(
      "missing required options: --name, --summary, --details",
    );
  });

  it("uses the code for each failure kind", async () => {
    const cli = memoryLikeCli();
    const codes = await Promise.all(
      [
        ["bogus", "--json"],
        ["catalog", "--bogus", "--json"],
        ["catalog", "--scope", "nope", "--json"],
        ["catalog", "extra", "--json"],
      ].map(async (argv) => {
        const result = await run(cli, argv);
        const parsed = JSON.parse(result.stdout ?? "") as {
          error: { code: string };
        };
        return parsed.error.code;
      }),
    );
    expect(codes).toEqual([
      "unknown_command",
      "unknown_option",
      "invalid_value",
      "unexpected_argument",
    ]);
  });

  it("reports a bare or incomplete invocation as missing_command, like the core CLI", async () => {
    const bare = await run(memoryLikeCli(), ["--json"]);
    expect(bare.exitCode).toBe(1);
    expect(JSON.parse(bare.stdout ?? "")).toMatchObject({
      ok: false,
      error: { code: "missing_command", message: "missing command" },
    });
  });

  it("carries the suggestion as the hint", async () => {
    const result = await run(memoryLikeCli(), ["catlog", "--json"]);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "unknown_command",
        message: "unknown command 'catlog'",
        hint: "Did you mean catalog?",
      },
    });
  });

  it("keeps --help out of the envelope", async () => {
    const result = await run(memoryLikeCli(), ["add", "--help", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBeUndefined();
  });
});

describe("PluginCliError", () => {
  const failing = (error: unknown) =>
    defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        go: cliCommand({
          summary: "Go",
          options: { json: { type: "boolean", description: "JSON" } },
          run() {
            throw error;
          },
        }),
      },
    });

  it("reports a command failure in the shared envelope", async () => {
    const cli = failing(
      new PluginCliError("Session stopped or expired", {
        code: "session_unavailable",
        hint: "Reopen with `bb demo open`",
        exitCode: 3,
      }),
    );
    const text = await run(cli, ["go"]);
    expect(text.exitCode).toBe(3);
    expect(text.stderr).toContain(
      "Session stopped or expired (Reopen with `bb demo open`)",
    );
    expect(text.stdout).toBeUndefined();

    const json = await run(cli, ["go", "--json"]);
    expect(json.exitCode).toBe(3);
    expect(JSON.parse(json.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "session_unavailable",
        message: "Session stopped or expired",
        hint: "Reopen with `bb demo open`",
      },
    });
    expect(json.stderr).toContain("Session stopped or expired");
  });

  it("defaults to command_failed and exit 1", async () => {
    const cli = failing(new PluginCliError("nope"));
    const json = await run(cli, ["go", "--json"]);
    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.stdout ?? "")).toEqual({
      ok: false,
      error: { code: "command_failed", message: "nope" },
    });
  });

  it("does not swallow other errors thrown by a command", async () => {
    const cli = failing(new Error("boom"));
    await expect(run(cli, ["go"])).rejects.toThrow("boom");
  });
});

describe("defineCli registration", () => {
  it("keeps the registration shape the host validates", () => {
    const cli = memoryLikeCli();
    expect(cli.name).toBe("memory");
    expect(cli.summary).toBe("Read and maintain durable memories");
    expect(cli.commands).toEqual([
      {
        name: "catalog",
        summary: "List compact memory summaries",
        usage:
          "bb memory catalog [--scope <all|project|global>] [--limit <1-100>] [--json]",
      },
      {
        name: "search",
        summary: "Search memory summaries",
        usage: "bb memory search <query...> [--json]",
      },
      {
        name: "add",
        summary: "Save a project or global memory",
        usage:
          "bb memory add --scope <project|global> --name <NAME> --summary <TEXT> --details <TEXT> [--tag <TAG>]... [--importance <0-100>] [--pinned] [--json]",
      },
    ]);
    for (const command of cli.commands ?? []) {
      expect(command.name).toMatch(/^[a-z0-9-]+$/u);
      expect(command.usage).not.toContain("\n");
    }
  });

  it("omits hidden commands from help and metadata but still runs them", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        visible: cliCommand({
          summary: "Visible",
          run: () => ({ exitCode: 0 }),
        }),
        legacy: cliCommand({
          summary: "Legacy",
          hidden: true,
          run: () => ({ exitCode: 0, stdout: "legacy" }),
        }),
      },
    });
    expect(cli.commands?.map((command) => command.name)).toEqual(["visible"]);
    expect((await run(cli, ["--help"])).stdout).not.toContain("legacy");
    expect((await run(cli, ["legacy"])).stdout).toBe("legacy");
  });
});

describe("defineCli review regressions", () => {
  const leaf = (summary: string) =>
    cliCommand({
      summary,
      run: () => ({ exitCode: 0, stdout: summary }),
    });

  it("passes a negative number through as a positional", async () => {
    const cli = defineCli({
      name: "pool",
      summary: "pool",
      commands: {
        "account priority": cliCommand({
          summary: "Set priority",
          positionals: [
            { name: "id", description: "Account id", required: true },
            { name: "priority", description: "Priority", required: true },
          ],
          options: {
            force: { type: "boolean", short: "-f", description: "Force" },
          },
          run: (input) => ({
            exitCode: 0,
            stdout: `${input.positionals.id}|${input.positionals.priority}|${input.options.force}`,
          }),
        }),
      },
    });

    expect(
      (await run(cli, ["account", "priority", "acct-1", "-1"])).stdout,
    ).toBe("acct-1|-1|false");
    expect(
      (await run(cli, ["account", "priority", "acct-1", "-.5", "-f"])).stdout,
    ).toBe("acct-1|-.5|true");
  });

  it("prints a command group's children for --help instead of failing", async () => {
    const cli = defineCli({
      name: "tasks",
      summary: "tasks",
      commands: {
        "project list": leaf("List projects"),
        "project create": leaf("Create a project"),
        status: leaf("Status"),
      },
    });

    const help = await run(cli, ["project", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("bb tasks project list");
    expect(help.stdout).toContain("bb tasks project create");
    expect(help.stdout).not.toContain("bb tasks status");

    const unknown = await run(cli, ["projcet", "--help"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown command 'projcet'");
  });

  it("refuses a spec whose split option would drop values", () => {
    expect(() =>
      defineCli({
        name: "demo",
        summary: "demo",
        commands: {
          add: cliCommand({
            summary: "Add",
            options: {
              tag: { type: "string", split: ",", description: "Tag" },
            },
            run: () => ({ exitCode: 0 }),
          }),
        },
      }),
    ).toThrow("--tag declares split without repeatable: true");
  });

  it("refuses a spelling that two options claim", () => {
    expect(() =>
      defineCli({
        name: "docs",
        summary: "docs",
        commands: {
          pull: cliCommand({
            summary: "Pull",
            options: {
              into: { type: "string", aliases: ["dir"], description: "Into" },
              folder: {
                type: "string",
                aliases: ["dir"],
                description: "Folder",
              },
            },
            run: () => ({ exitCode: 0 }),
          }),
        },
      }),
    ).toThrow("bb docs pull: --dir is declared by both --into and --folder");
  });

  it("emits the JSON envelope for --json=true and not for --json=false", async () => {
    const cli = defineCli({
      name: "demo",
      summary: "demo",
      commands: {
        show: cliCommand({
          summary: "Show",
          options: { json: { type: "boolean", description: "JSON" } },
          run: () => ({ exitCode: 0 }),
        }),
      },
    });

    const asJson = await run(cli, ["show", "--json=true", "--bogus"]);
    expect(JSON.parse(asJson.stdout ?? "")).toMatchObject({
      ok: false,
      error: { code: "unknown_option" },
    });
    const asText = await run(cli, ["show", "--json=false", "--bogus"]);
    expect(asText.stdout ?? "").toBe("");
  });
});
