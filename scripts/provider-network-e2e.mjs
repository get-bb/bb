import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Provider network e2e runs only on an isolated CI runner.");
}

const { toCodexPermissionSettings } =
  await import("../plugins/provider-codex/src/session-params.ts");
const { buildSessionOptions } =
  await import("../plugins/provider-claude-code/src/bridge/session-options.ts");
const { SdkSession } =
  await import("../plugins/provider-claude-code/src/bridge/sdk-session.ts");
const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "provider-network-e2e-"));
const servers = [];
const evidence = [];
const failures = [];

async function run(command, args, options = {}) {
  try {
    const pending = exec(command, args, {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
    pending.child.stdin?.end();
    const result = await pending;
    return { code: 0, ...result };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function listen(server) {
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

function sse(response, events) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

function anthropicEvents(content) {
  const tool = content.type === "tool_use";
  return [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: tool
        ? { ...content, input: {} }
        : { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: tool
        ? {
            type: "input_json_delta",
            partial_json: JSON.stringify(content.input),
          }
        : { type: "text_delta", text: content.text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: {
        stop_reason: tool ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
}

function codexEvents(item) {
  return [
    { type: "response.created", response: { id: "resp_fixture" } },
    { type: "response.output_item.done", item },
    {
      type: "response.completed",
      response: {
        id: "resp_fixture",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
}

async function modelFixture(provider) {
  let commandSent = false;
  const errors = [];
  const server = createHttpServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = body ? JSON.parse(body) : {};
      if (request.url.includes("count_tokens")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      if (provider === "claude-code") {
        const canRun = payload.tools?.some((tool) => tool.name === "Bash");
        const content =
          canRun && !commandSent
            ? {
                type: "tool_use",
                id: "toolu_fixture",
                name: "Bash",
                input: { command: "bash ./probe.sh", timeout: 30_000 },
              }
            : { type: "text", text: "Network isolation probe complete." };
        if (content.type === "tool_use") commandSent = true;
        sse(response, anthropicEvents(content));
        return;
      }
      const tools = (payload.tools ?? []).flatMap((tool) =>
        tool.type === "namespace" ? (tool.tools ?? []) : [tool],
      );
      const shell = tools.find((tool) =>
        ["exec_command", "shell_command", "shell"].includes(tool.name),
      );
      if (!commandSent)
        assert.ok(shell, "Codex must expose its native shell tool");
      const item = !commandSent
        ? {
            type: "function_call",
            call_id: "call_fixture",
            name: shell.name,
            arguments: JSON.stringify(
              shell.name === "exec_command"
                ? { cmd: "bash ./probe.sh", yield_time_ms: 10000 }
                : shell.name === "shell"
                  ? { command: ["bash", "./probe.sh"], timeout_ms: 30_000 }
                  : { command: "bash ./probe.sh", timeout_ms: 30_000 },
            ),
          }
        : {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Network isolation probe complete.",
              },
            ],
          };
      commandSent = true;
      sse(response, codexEvents(item));
    } catch (error) {
      errors.push(error);
      response.writeHead(500);
      response.end("Fixture request failed");
    }
  });
  return { port: await listen(server), errors, didRun: () => commandSent };
}

async function claudeRun(cwd, env) {
  const options = buildSessionOptions(
    {
      cwd,
      instructionMode: "replace",
      model: "claude-sonnet-4-6",
      permissionMode: "acceptEdits",
      permissionScope: "workspace",
      networkAccess: false,
      serviceTier: "default",
      workflowsEnabled: false,
      chromeEnabled: false,
      disable1MContext: true,
      artifactsEnabled: false,
      sandboxEnabled: true,
      memoryEnabled: false,
    },
    env,
  );
  assert.equal(options.sandbox?.enabled, true);
  assert.equal(options.sandbox?.allowUnsandboxedCommands, false);
  const messages = [];
  let session;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Claude sandbox probe timed out")),
        120_000,
      );
      const finish = (error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      session = new SdkSession(
        {
          ...options,
          canUseTool: async () => ({
            behavior: "deny",
            message: "Escalation is disabled.",
          }),
        },
        (message) => {
          messages.push(message);
          if (message.type === "result")
            finish(
              message.is_error ? new Error(JSON.stringify(message)) : undefined,
            );
        },
        finish,
      );
      session.start();
      session
        .pushInput("Execute bash ./probe.sh once, then report completion.")
        .catch(finish);
    });
  } finally {
    session?.stop();
  }
  return messages;
}

async function codexRun(cwd, env, modelPort) {
  const policy = toCodexPermissionSettings({
    options: {
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "deny",
      networkAccess: false,
    },
    gitWritableRoots: [],
    additionalWorkspaceWriteRoots: [],
  });
  assert.equal(policy.sandboxPolicy.networkAccess, false);
  assert.equal(policy.approvalPolicy, "never");
  const result = await run(
    "codex",
    [
      "-a",
      policy.approvalPolicy,
      "-s",
      policy.sandbox,
      "-c",
      `sandbox_workspace_write.network_access=${policy.sandboxPolicy.networkAccess}`,
      "-c",
      'model_provider="fixture"',
      "-c",
      `model_providers.fixture={name="fixture",base_url="http://127.0.0.1:${modelPort}/v1",wire_api="responses",requires_openai_auth=false}`,
      "-c",
      'web_search="disabled"',
      "exec",
      "--skip-git-repo-check",
      "--json",
      "-m",
      "gpt-5.1-codex",
      "Execute bash ./probe.sh once, then report completion.",
    ],
    { cwd, env },
  );
  assert.equal(result.code, 0, result.stderr);
  return `${result.stdout}\n${result.stderr}`;
}

try {
  const certificate = join(root, "certificate.pem");
  const key = join(root, "key.pem");
  const certResult = await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    key,
    "-out",
    certificate,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  assert.equal(certResult.code, 0, certResult.stderr);
  let publicationRequests = 0;
  const publication = createHttpsServer(
    {
      key: await readFile(key),
      cert: await readFile(certificate),
    },
    (_request, response) => {
      publicationRequests += 1;
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Publication fixture reached" }));
    },
  );
  const publicationPort = await listen(publication);

  for (const provider of ["codex", "claude-code"]) {
    try {
      const cwd = join(root, provider, "workspace");
      const home = join(root, provider, "home");
      await mkdir(cwd, { recursive: true });
      await mkdir(home, { recursive: true });
      await mkdir(join(home, ".codex"), { recursive: true });
      await mkdir(join(home, ".claude"), { recursive: true });
      const model = await modelFixture(provider);
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        LANG: "C.UTF-8",
        GH_HOST: `localhost:${publicationPort}`,
        GH_ENTERPRISE_TOKEN: "fixture-token",
        GH_PROMPT_DISABLED: "1",
        SSL_CERT_FILE: certificate,
        GIT_SSL_CAINFO: certificate,
        GIT_TERMINAL_PROMPT: "0",
        CODEX_HOME: join(home, ".codex"),
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.port}`,
        ANTHROPIC_API_KEY: "fixture-key",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      };
      for (const args of [
        ["init", "-b", "change"],
        ["config", "user.email", "fixture@example.invalid"],
        ["config", "user.name", "Sandbox fixture"],
        ["commit", "--allow-empty", "-m", "Fixture"],
        [
          "remote",
          "add",
          "origin",
          `https://localhost:${publicationPort}/owner/repository.git`,
        ],
      ]) {
        const result = await run("git", args, { cwd, env });
        assert.equal(result.code, 0, result.stderr);
      }
      const commands = [
        ["git", ["push", "origin", "HEAD"]],
        [
          "gh",
          [
            "pr",
            "create",
            "--repo",
            `${env.GH_HOST}/owner/repository`,
            "--head",
            "change",
            "--base",
            "main",
            "--title",
            "Fixture",
            "--body",
            "Fixture",
          ],
        ],
      ];
      for (const [command, args] of commands) {
        const before = publicationRequests;
        const result = await run(command, args, { cwd, env });
        assert.ok(
          publicationRequests > before,
          `${provider}: unsandboxed ${command} must reach the publication fixture: ${result.stderr}`,
        );
      }
      await writeFile(
        join(cwd, "probe.sh"),
        [
          "set -u",
          `export GH_HOST='localhost:${publicationPort}'`,
          "export GH_ENTERPRISE_TOKEN='fixture-token' GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0",
          `export SSL_CERT_FILE='${certificate}' GIT_SSL_CAINFO='${certificate}'`,
          "printf 'edited locally\\n' > edited.txt",
          "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('edited.txt','utf8'),'edited locally\\n')\" || exit 91",
          "git push origin HEAD > git-output.txt 2>&1",
          "git_result=$?",
          'gh pr create --repo "$GH_HOST/owner/repository" --head change --base main --title Fixture --body Fixture > gh-output.txt 2>&1',
          "gh_result=$?",
          'printf \'%s %s\\n\' "$git_result" "$gh_result" > results.txt',
        ].join("\n"),
      );
      const before = publicationRequests;
      const transcript =
        provider === "codex"
          ? await codexRun(cwd, env, model.port)
          : await claudeRun(cwd, env);
      assert.deepEqual(model.errors, []);
      assert.equal(
        model.didRun(),
        true,
        `${provider}: no model tool call was requested: ${JSON.stringify(transcript)}`,
      );
      let statuses;
      try {
        statuses = (await readFile(join(cwd, "results.txt"), "utf8"))
          .trim()
          .split(" ")
          .map(Number);
      } catch (error) {
        throw new Error(
          `${provider}: native shell did not complete the probe: ${JSON.stringify(transcript)}`,
          { cause: error },
        );
      }
      assert.equal(
        await readFile(join(cwd, "edited.txt"), "utf8"),
        "edited locally\n",
      );
      assert.equal(statuses.length, 2);
      assert.ok(
        statuses.every(
          (status) => Number.isInteger(status) && status > 0 && status !== 127,
        ),
      );
      for (const output of ["git-output.txt", "gh-output.txt"]) {
        const message = await readFile(join(cwd, output), "utf8");
        assert.match(
          message,
          /connect|network|proxy|resolve|denied|operation not permitted|socket/i,
        );
        assert.doesNotMatch(
          message,
          /not logged|auth login|authentication required|certificate verify/i,
        );
      }
      assert.equal(
        publicationRequests,
        before,
        `${provider}: sandbox allowed a publication request`,
      );
      evidence.push({
        provider,
        localEditAndTest: "passed",
        gitPush: "blocked",
        ghPrCreate: "blocked",
        publicationRequests: 0,
      });
      console.log(JSON.stringify(evidence.at(-1)));
    } catch (error) {
      failures.push(
        new Error(`${provider} network isolation failed`, { cause: error }),
      );
      console.error(provider, error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Native provider network isolation failed",
    );
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      evidence
        .map(
          (result) =>
            `- ${result.provider}: local edit/test passed; git push and gh pr create blocked; zero publication requests.`,
        )
        .join("\n"),
      { flag: "a" },
    );
  }
} finally {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
  await rm(root, { recursive: true, force: true });
}
