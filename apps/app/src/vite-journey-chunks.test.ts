import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Rolldown } from "vite";
import { expect, it } from "vitest";
import { journeyChunkGroups } from "../vite-journey-chunks";

function chunkWith(
  chunks: readonly Rolldown.OutputChunk[],
  file: string,
): Rolldown.OutputChunk {
  const chunk = chunks.find((candidate) =>
    Object.keys(candidate.modules).some((id) => id.endsWith(`/${file}`)),
  );
  if (chunk === undefined) throw new Error(`no chunk contains ${file}`);
  return chunk;
}

function staticClosure(
  chunks: readonly Rolldown.OutputChunk[],
  fileName: string,
): Set<string> {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    chunks.find((chunk) => chunk.fileName === name)?.imports.forEach(visit);
  };
  visit(fileName);
  return seen;
}

it("merges each journey's used modules into one chunk without making another journey's entry eager", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-journey-")));
  try {
    await Promise.all(
      Object.entries({
        "index.html": '<script type="module" src="/main.js"></script>',
        "main.js":
          'window.route = import("./route.js"); window.thread = () => import("./thread.js"); window.compose = () => import("./compose.js"); window.menu = () => import("./menu.js");',
        "route.js":
          'import { shell, starred } from "./barrel.js"; import { pill } from "./pill.js"; export default shell + pill + starred;',
        "barrel.js":
          'export { shell } from "./shell.js"; export { heavy } from "./heavy.js"; export * from "./star.js";',
        "shell.js": "export const shell = Math.random();",
        "heavy.js": "export const heavy = Math.random();",
        "star.js": "export const starred = Math.random();",
        "pill.js": "export const pill = Math.random();",
        "menu.js":
          'import { pill } from "./pill.js"; import { heavy } from "./heavy.js"; export default pill + heavy;',
        "thread.js":
          'import { shared } from "./shared.js"; import { timeline } from "./timeline.js"; window.diff = () => import("./diff.js"); export default shared + timeline;',
        "compose.js":
          'import { shared } from "./shared.js"; import { editor } from "./editor.js"; export default shared + editor;',
        "shared.js": "export const shared = Math.random();",
        "timeline.js": "export const timeline = Math.random();",
        "editor.js": "export const editor = Math.random();",
        "diff.js": "export default Math.random();",
      }).map(([name, source]) => writeFile(join(root, name), source)),
    );
    const output = await build({
      root,
      configFile: false,
      logLevel: "silent",
      build: {
        minify: false,
        write: false,
        rolldownOptions: {
          output: {
            advancedChunks: {
              groups: journeyChunkGroups(root, [
                { name: "workspace", entries: ["route.js"] },
                { name: "pages", entries: ["thread.js", "compose.js"] },
                { name: "thread-page", entries: ["thread.js"] },
                { name: "compose-page", entries: ["compose.js"] },
              ]),
            },
          },
        },
      },
    });
    const [result] = Array.isArray(output) ? output : [output];
    if (result === undefined || !("output" in result)) {
      throw new Error("expected a build result");
    }
    const chunks = result.output.filter(
      (item): item is Rolldown.OutputChunk => item.type === "chunk",
    );

    const workspace = chunkWith(chunks, "route.js");
    expect(chunkWith(chunks, "shell.js")).toBe(workspace);
    expect(chunkWith(chunks, "pill.js")).toBe(workspace);
    expect(chunkWith(chunks, "star.js")).toBe(workspace);
    expect(chunkWith(chunks, "menu.js")).not.toBe(workspace);
    expect(chunkWith(chunks, "heavy.js")).not.toBe(workspace);

    const thread = chunkWith(chunks, "thread.js");
    const compose = chunkWith(chunks, "compose.js");
    expect(chunkWith(chunks, "timeline.js")).toBe(thread);
    expect(chunkWith(chunks, "editor.js")).toBe(compose);
    const shared = chunkWith(chunks, "shared.js");
    expect([thread, compose]).not.toContain(shared);
    expect(staticClosure(chunks, thread.fileName)).not.toContain(
      compose.fileName,
    );
    expect(staticClosure(chunks, compose.fileName)).not.toContain(
      thread.fileName,
    );

    const diff = chunkWith(chunks, "diff.js");
    expect(diff).not.toBe(thread);
    expect(staticClosure(chunks, thread.fileName)).not.toContain(diff.fileName);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
