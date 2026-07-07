// bb-plugin-simple-notes — a minimal Apple-Notes-style markdown notebook.
//
// One folder on disk (default ~/Notes, auto-created on load). The rpc surface
// lists notes with a derived title/preview/mtime so the frontend can show a
// recent-first list, and reads/creates/saves/deletes the underlying `.md`
// files. Reads and writes go through `bb.sdk.files` for its compare-and-swap
// guard; listing and delete use node fs directly (this is a local notebook).
// The editor (Tiptap) is headless, so no stylesheet is served from here.
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";

const DEFAULT_DIR = "~/Notes";
const PREVIEW_LENGTH = 100;

interface NoteSummary {
  path: string; // filename relative to the notes folder (flat, e.g. "Todo.md")
  title: string; // first non-empty line, heading markers stripped
  preview: string; // a short snippet of the body
  modifiedAtMs: number;
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

/** A note name is a flat `.md` filename — reject anything that could escape the folder. */
function requireNoteName(value: unknown): string {
  const name = requireString(value, "path");
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.startsWith(".") ||
    !/\.md$/i.test(name)
  ) {
    throw new Error(`Invalid note name: ${name}`);
  }
  return name;
}

/** kebab-case an ASCII slug from a title ("My Note!" → "my-note"). */
function kebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Turn a user-typed title into a safe filename base (no extension). */
function sanitizeBase(raw: string): string {
  return raw
    .replace(/\.md$/i, "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Strip leading markdown markers (heading, quote, bullet, task checkbox). */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
}

function deriveTitle(content: string, fallback: string): string {
  for (const line of content.split("\n")) {
    const stripped = cleanLine(line);
    if (stripped) return stripped.slice(0, 120);
  }
  return fallback;
}

function derivePreview(content: string, title: string): string {
  const lines = content
    .split("\n")
    .map(cleanLine)
    .filter((line) => line.length > 0 && line !== title);
  return lines.join(" ").slice(0, PREVIEW_LENGTH);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    directory: {
      type: "string",
      label: "Notes folder (~ ok)",
      default: DEFAULT_DIR,
    },
  });

  async function getRoot(): Promise<string> {
    const { directory } = await settings.get();
    const raw = directory.trim() || DEFAULT_DIR;
    return path.resolve(expandHome(raw));
  }

  // Make the notebook usable out of the box — no configuration step needed.
  try {
    await mkdir(await getRoot(), { recursive: true });
  } catch (error) {
    bb.log.warn(
      `could not create notes folder: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // --- rpc ------------------------------------------------------------------

  bb.rpc.register({
    async listNotes(): Promise<{
      root: string;
      notes: NoteSummary[];
      error: string | null;
    }> {
      const root = await getRoot();
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        return {
          root,
          notes: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const notes: NoteSummary[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
        const full = path.join(root, entry.name);
        try {
          const [info, content] = await Promise.all([
            stat(full),
            readFile(full, "utf8"),
          ]);
          const title = deriveTitle(content, entry.name.replace(/\.md$/i, ""));
          notes.push({
            path: entry.name,
            title,
            preview: derivePreview(content, title),
            modifiedAtMs: info.mtimeMs,
          });
        } catch {
          // Skip files that vanish or can't be read mid-listing.
        }
      }
      notes.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
      return { root, notes, error: null };
    },

    async readNote(input: { path?: unknown }) {
      const root = await getRoot();
      const name = requireNoteName(input.path);
      // The bundled SDK types stub result shapes to `never` outside the bb
      // monorepo, so narrow the read result to what we consume.
      const file = (await bb.sdk.files.read({
        path: path.join(root, name),
        rootPath: root,
      })) as { content: string; sha256: string };
      return { content: file.content, sha256: file.sha256 };
    },

    async saveNote(input: {
      path?: unknown;
      content?: unknown;
      expectedSha256?: unknown;
    }) {
      const root = await getRoot();
      const name = requireNoteName(input.path);
      if (typeof input.content !== "string") {
        throw new Error(`"content" must be a string`);
      }
      return bb.sdk.files.write({
        path: path.join(root, name),
        rootPath: root,
        content: input.content,
        createParents: true,
        ...(input.expectedSha256 === null ||
        typeof input.expectedSha256 === "string"
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      });
    },

    async createNote(input: { name?: unknown; content?: unknown }) {
      const root = await getRoot();
      await mkdir(root, { recursive: true });
      const base =
        sanitizeBase(typeof input.name === "string" ? input.name : "") ||
        "Untitled";
      const existing = new Set(
        (await readdir(root).catch(() => [] as string[])).map((n) =>
          n.toLowerCase(),
        ),
      );
      let name = `${base}.md`;
      let counter = 2;
      while (existing.has(name.toLowerCase())) {
        name = `${base} ${counter}.md`;
        counter += 1;
      }
      const content = typeof input.content === "string" ? input.content : "";
      await bb.sdk.files.write({
        path: path.join(root, name),
        rootPath: root,
        content,
        createParents: true,
        expectedSha256: null, // create-only: fail if it somehow already exists
      });
      return { path: name };
    },

    async deleteNote(input: { path?: unknown }) {
      const root = await getRoot();
      const name = requireNoteName(input.path);
      await unlink(path.join(root, name));
      return { ok: true };
    },

    /**
     * Settle a note's filename to the kebab-case of its first header
     * (Apple-Notes style). Called when leaving a note, not per keystroke, so
     * the filename doesn't churn while the title is being typed. Returns the
     * resulting path (unchanged when there's no title or it already matches).
     */
    async renameToTitle(input: { path?: unknown }) {
      const root = await getRoot();
      const name = requireNoteName(input.path);
      let content: string;
      try {
        content = await readFile(path.join(root, name), "utf8");
      } catch {
        return { path: name };
      }
      const base = kebabCase(deriveTitle(content, ""));
      if (!base) return { path: name };
      let desired = `${base}.md`;
      if (desired.toLowerCase() === name.toLowerCase()) return { path: name };
      const existing = new Set(
        (await readdir(root).catch(() => [] as string[])).map((n) =>
          n.toLowerCase(),
        ),
      );
      if (existing.has(desired.toLowerCase())) {
        let counter = 2;
        while (existing.has(`${base}-${counter}.md`.toLowerCase())) {
          counter += 1;
        }
        desired = `${base}-${counter}.md`;
      }
      await rename(path.join(root, name), path.join(root, desired));
      return { path: desired };
    },
  });
}
