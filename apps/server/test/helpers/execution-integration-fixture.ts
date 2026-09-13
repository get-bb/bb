import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function createExecutionIntegrationFixture() {
  const source = fileURLToPath(
    new URL("../../../../tests/scripted-echo-provider", import.meta.url),
  );
  const root = await mkdtemp(join(tmpdir(), "bb-execution-fixture-"));
  await Promise.all(
    ["package.json", "server.ts", "host.ts", "src"].map((name) =>
      cp(join(source, name), join(root, name), { recursive: true }),
    ),
  );
  await symlink(
    join(source, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
