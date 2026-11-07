import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findUnsupportedPluginServerApi } from "../../../src/services/plugins/plugin-server-worker-preflight.js";

describe("plugin server worker preflight", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bb-preflight-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds an unsupported API in a chunk the entry imports", async () => {
    await writeFile(
      join(dir, "server.js"),
      `import { tools } from "./chunks/tools.js";\nexport default (bb) => tools(bb);`,
    );
    await mkdir(join(dir, "chunks"));
    await writeFile(
      join(dir, "chunks", "tools.js"),
      `export const tools = (bb) => { const { agents } = bb; agents.registerTool({}); };`,
    );
    await expect(
      findUnsupportedPluginServerApi(join(dir, "server.js")),
    ).resolves.toBe("bb.agents.registerTool");
  });

  it("finds destructured agents.configure and ignores ordinary words", async () => {
    await writeFile(
      join(dir, "configure.js"),
      `export default (bb) => { const { configure } = bb.agents; configure(() => ({})); };`,
    );
    await writeFile(
      join(dir, "plain.js"),
      `const agents = ["codex"]; const providers = {}; export default (bb) => bb.rpc.register({}, {}, { agents, providers, configure: true });`,
    );
    await expect(
      findUnsupportedPluginServerApi(join(dir, "configure.js")),
    ).resolves.toBe("bb.agents.configure");
    await expect(
      findUnsupportedPluginServerApi(join(dir, "plain.js")),
    ).resolves.toBeNull();
  });
});
