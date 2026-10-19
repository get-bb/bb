import { randomUUID } from "node:crypto";
import type { BbPluginApi, ComposerDraft } from "@get-bb/plugin-sdk";
import { promptSchema } from "./contract.js";

type PluginDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

export const STARRED_PROMPT_MIGRATIONS = [
  `CREATE TABLE starred_prompts (
    id TEXT PRIMARY KEY,
    prompt_json TEXT NOT NULL,
    text TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `ALTER TABLE starred_prompts ADD COLUMN title TEXT`,
];

export interface StarredPrompt {
  id: string;
  title: string | null;
  prompt: ComposerDraft;
  createdAt: number;
  lastUsedAt: number | null;
}

interface StarredPromptRecord {
  id: string;
  title: string | null;
  prompt_json: string;
  created_at: number;
  last_used_at: number | null;
}

function fromRecord(record: StarredPromptRecord): StarredPrompt {
  const { text, mentions } = promptSchema.parse(JSON.parse(record.prompt_json));
  return {
    id: record.id,
    title: record.title,
    prompt: { text, mentions },
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
  };
}

export interface StarredPromptStore {
  list(): StarredPrompt[];
  star(
    prompt: ComposerDraft,
    title: string | null,
    now: number,
  ): StarredPrompt | null;
  setTitle(id: string, title: string | null): boolean;
  unstar(id: string): boolean;
  markUsed(id: string, now: number): void;
}

export function createStarredPromptStore(
  db: PluginDatabase,
): StarredPromptStore {
  const listStatement = db.prepare<[], StarredPromptRecord>(
    `SELECT id, title, prompt_json, created_at, last_used_at
       FROM starred_prompts
      ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC`,
  );
  const findByTextStatement = db.prepare<[string], StarredPromptRecord>(
    `SELECT id, title, prompt_json, created_at, last_used_at
       FROM starred_prompts WHERE text = ?`,
  );
  const insertStatement = db.prepare(
    `INSERT INTO starred_prompts (id, title, prompt_json, text, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  const setTitleStatement = db.prepare(
    `UPDATE starred_prompts SET title = ? WHERE id = ?`,
  );
  const deleteStatement = db.prepare(
    `DELETE FROM starred_prompts WHERE id = ?`,
  );
  const markUsedStatement = db.prepare(
    `UPDATE starred_prompts SET last_used_at = ? WHERE id = ?`,
  );

  return {
    list: () => listStatement.all().map(fromRecord),
    star({ text, mentions }, title, now) {
      if (text.trim().length === 0) return null;
      const existing = findByTextStatement.get(text);
      if (existing !== undefined) return fromRecord(existing);
      const id = `prompt_${randomUUID()}`;
      insertStatement.run(
        id,
        title,
        JSON.stringify({ text, mentions }),
        text,
        now,
      );
      return {
        id,
        title,
        prompt: { text, mentions },
        createdAt: now,
        lastUsedAt: null,
      };
    },
    setTitle: (id, title) => setTitleStatement.run(title, id).changes > 0,
    unstar: (id) => deleteStatement.run(id).changes > 0,
    markUsed(id, now) {
      markUsedStatement.run(now, id);
    },
  };
}
