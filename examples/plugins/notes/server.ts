// bb-plugin-notes — Obsidian-style markdown notes (plugin design hero for
// bb.sdk.files + the fileOpener/useComposer/subPath surfaces).
//
// The backend is a thin file service over `bb.sdk.files`: the user mounts
// directories via a setting, the rpc surface lists/reads/CAS-saves markdown
// under those mounts, an fs watcher pushes tree refreshes over realtime, and
// a mention provider lets `@`-mentions resolve a note's content at send
// time. Milkdown Crepe's theme CSS is served from the plugin's own http
// route (the frontend bundle pipeline ships only Tailwind-compiled CSS).
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";

interface NotesMount {
  name: string;
  root: string;
}

interface MountListing {
  name: string;
  root: string;
  files: { path: string; name: string }[];
  error: string | null;
}

interface OpenerSource {
  kind: "workspace" | "host" | "thread-storage";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
}

const NOTE_EXTENSIONS = new Set(["md", "mdx", "markdown"]);
const LIST_LIMIT = 2000;

function isNotePath(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return NOTE_EXTENSIONS.has(filePath.slice(dotIndex + 1).toLowerCase());
}

function expandHome(rawPath: string): string {
  if (rawPath === "~") return os.homedir();
  if (rawPath.startsWith("~/")) return path.join(os.homedir(), rawPath.slice(2));
  return rawPath;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value;
}

/** Reject note paths that could step outside a mount. */
function requireRelativeNotePath(value: unknown): string {
  const notePath = requireString(value, "path");
  const segments = notePath.split("/");
  if (
    path.isAbsolute(notePath) ||
    segments.some((s) => s.length === 0 || s === "." || s === "..")
  ) {
    throw new Error(`Invalid note path: ${notePath}`);
  }
  return notePath;
}

/**
 * Inline the `@import './x.css'` chain of Crepe's common theme stylesheet so
 * one http response carries the whole thing (a <link> to this route has no
 * base URL the relative imports could resolve against).
 */
async function loadCrepeCss(): Promise<string> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@milkdown/crepe/theme/common/style.css");
  // Bare-specifier imports (e.g. @milkdown/kit/...) are Crepe's own deps —
  // resolve them from Crepe's package context, not the plugin's.
  const crepeRequire = createRequire(entry);
  const seen = new Set<string>();
  const inline = async (file: string): Promise<string> => {
    if (seen.has(file)) return "";
    seen.add(file);
    const source = await readFile(file, "utf8");
    const parts = await Promise.all(
      source.split("\n").map(async (line) => {
        const match = /^@import\s+['"](.+\.css)['"];/.exec(line.trim());
        if (!match?.[1]) return line;
        const specifier = match[1];
        // Relative imports resolve against the importing file; bare
        // specifiers (e.g. @milkdown/kit/prose/view/style/prosemirror.css)
        // resolve through node — both end up inlined.
        const resolved = specifier.startsWith(".")
          ? path.join(path.dirname(file), specifier)
          : crepeRequire.resolve(specifier);
        return inline(resolved);
      }),
    );
    return parts.join("\n");
  };
  return inline(entry);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    directories: {
      type: "string",
      label: "Note directories (comma-separated, ~ ok)",
      default: "",
    },
  });

  async function getMounts(): Promise<NotesMount[]> {
    const { directories } = await settings.get();
    const roots = directories
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => path.resolve(expandHome(entry)));
    const seenNames = new Map<string, number>();
    return roots.map((root) => {
      const base = path.basename(root) || root;
      const count = seenNames.get(base) ?? 0;
      seenNames.set(base, count + 1);
      return { name: count === 0 ? base : `${base} (${count + 1})`, root };
    });
  }

  async function requireMount(rootInput: unknown): Promise<NotesMount> {
    const root = requireString(rootInput, "root");
    const mount = (await getMounts()).find((m) => m.root === root);
    if (!mount) {
      throw new Error(
        `"${root}" is not a configured notes directory — add it in Settings → Plugins → notes`,
      );
    }
    return mount;
  }

  if ((await getMounts()).length === 0) {
    bb.status.needsConfiguration(
      "Set the notes directories setting (e.g. ~/Notes), then `bb plugin reload notes`.",
    );
  }

  // --- rpc ------------------------------------------------------------------

  bb.rpc.register({
    async listNotes(): Promise<{ mounts: MountListing[] }> {
      const mounts = await getMounts();
      const listings = await Promise.all(
        mounts.map(async (mount): Promise<MountListing> => {
          try {
            const result = await bb.sdk.files.list({
              path: mount.root,
              limit: LIST_LIMIT,
            });
            const files = result.files
              .filter((file) => isNotePath(file.path))
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((file) => ({ path: file.path, name: file.name }));
            return { ...mount, files, error: null };
          } catch (error) {
            return {
              ...mount,
              files: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      return { mounts: listings };
    },

    async readNote(input: { root?: unknown; path?: unknown }) {
      const mount = await requireMount(input.root);
      const notePath = requireRelativeNotePath(input.path);
      const file = await bb.sdk.files.read({
        path: path.join(mount.root, notePath),
        rootPath: mount.root,
      });
      return { content: file.content, sha256: file.sha256 };
    },

    async saveNote(input: {
      root?: unknown;
      path?: unknown;
      content?: unknown;
      expectedSha256?: unknown;
    }) {
      const mount = await requireMount(input.root);
      const notePath = requireRelativeNotePath(input.path);
      if (typeof input.content !== "string") {
        throw new Error(`"content" must be a string`);
      }
      const result = await bb.sdk.files.write({
        path: path.join(mount.root, notePath),
        rootPath: mount.root,
        content: input.content,
        createParents: true,
        ...(input.expectedSha256 === null ||
        typeof input.expectedSha256 === "string"
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      });
      return result;
    },

    /**
     * Resolve a fileOpener target into { absPath, rootPath, hostId } the
     * read/write file rpcs below can use. Workspace paths are relative to
     * the environment's worktree; host paths are already absolute.
     */
    async resolveFile(input: { source?: OpenerSource; path?: unknown }) {
      const filePath = requireString(input.path, "path");
      const source = input.source;
      if (source?.kind === "host") {
        return { absPath: filePath, rootPath: null, hostId: null };
      }
      if (source?.kind === "workspace" && source.environmentId) {
        const environment = await bb.sdk.environments.get({
          environmentId: source.environmentId,
        });
        if (!environment.path) {
          throw new Error("This environment has no workspace path");
        }
        return {
          absPath: path.join(environment.path, filePath),
          rootPath: environment.path,
          hostId: environment.hostId,
        };
      }
      throw new Error(
        "Only workspace and host files can open in the notes editor",
      );
    },

    async readFile(input: {
      absPath?: unknown;
      rootPath?: unknown;
      hostId?: unknown;
    }) {
      const file = await bb.sdk.files.read({
        path: requireString(input.absPath, "absPath"),
        ...(typeof input.rootPath === "string"
          ? { rootPath: input.rootPath }
          : {}),
        ...(typeof input.hostId === "string" ? { hostId: input.hostId } : {}),
      });
      return { content: file.content, sha256: file.sha256 };
    },

    async writeFile(input: {
      absPath?: unknown;
      rootPath?: unknown;
      hostId?: unknown;
      content?: unknown;
      expectedSha256?: unknown;
    }) {
      if (typeof input.content !== "string") {
        throw new Error(`"content" must be a string`);
      }
      return bb.sdk.files.write({
        path: requireString(input.absPath, "absPath"),
        content: input.content,
        ...(typeof input.rootPath === "string"
          ? { rootPath: input.rootPath }
          : {}),
        ...(typeof input.hostId === "string" ? { hostId: input.hostId } : {}),
        ...(input.expectedSha256 === null ||
        typeof input.expectedSha256 === "string"
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      });
    },
  });

  // --- live tree refresh ------------------------------------------------------

  bb.background.service("notes-watcher", {
    start(signal) {
      const watchers: FSWatcher[] = [];
      let debounce: NodeJS.Timeout | null = null;
      void getMounts().then((mounts) => {
        if (signal.aborted) return;
        for (const mount of mounts) {
          try {
            // Recursive fs.watch is unavailable on some platforms — the
            // tree then refreshes only on demand, which is fine.
            const watcher = watch(mount.root, { recursive: true }, () => {
              if (debounce) clearTimeout(debounce);
              debounce = setTimeout(() => {
                bb.realtime.publish("notes-changed", {});
              }, 250);
            });
            watcher.on("error", () => watcher.close());
            watchers.push(watcher);
          } catch {
            bb.log.warn(`cannot watch ${mount.root}; refresh is manual`);
          }
        }
      });
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          if (debounce) clearTimeout(debounce);
          for (const watcher of watchers) watcher.close();
          resolve();
        });
      });
    },
  });

  // --- Crepe theme css ---------------------------------------------------------

  let crepeCss: string | null = null;
  bb.http.route("GET", "/crepe.css", async () => {
    crepeCss ??= await loadCrepeCss();
    return new Response(crepeCss, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  });

  // --- @note mentions ------------------------------------------------------------

  bb.ui.registerMentionProvider({
    id: "notes",
    label: "Notes",
    async search({ query }) {
      const mounts = await getMounts();
      const needle = query.toLowerCase();
      const items: { id: string; title: string; subtitle: string }[] = [];
      for (const mount of mounts) {
        try {
          const result = await bb.sdk.files.list({
            path: mount.root,
            query,
            limit: 25,
          });
          for (const file of result.files) {
            if (!isNotePath(file.path)) continue;
            if (
              needle.length > 0 &&
              !file.path.toLowerCase().includes(needle)
            ) {
              continue;
            }
            items.push({
              id: `${mount.root} ${file.path}`,
              title: file.name,
              subtitle: `${mount.name}/${file.path}`,
            });
          }
        } catch {
          // Unreachable mount: contribute nothing from it.
        }
      }
      return items.slice(0, 25);
    },
    async resolve(itemId) {
      const [root, notePath] = itemId.split(" ");
      if (!root || !notePath) throw new Error(`Unknown note: ${itemId}`);
      const mount = (await getMounts()).find((m) => m.root === root);
      if (!mount) throw new Error(`"${root}" is no longer a notes directory`);
      const file = await bb.sdk.files.read({
        path: path.join(root, notePath),
        rootPath: root,
      });
      return {
        context: `Note ${notePath} (from ${mount.name}):\n\n${file.content}`,
      };
    },
  });
}
