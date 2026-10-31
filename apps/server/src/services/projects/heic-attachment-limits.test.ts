import { createMigratedConnection } from "@bb/db/testing";
import { projects, projectAttachments, type DbConnection } from "@bb/db";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storeAttachment } from "./attachments.js";
import { normalizeHeifAttachment } from "./heic-conversion.js";

vi.mock("./heic-conversion.js", () => ({ normalizeHeifAttachment: vi.fn() }));

let db: DbConnection;
beforeEach(() => {
  db = createMigratedConnection();
  db.insert(projects)
    .values({
      id: "project-heic-limit",
      name: "HEIC limits",
      kind: "standard",
      sortKey: "1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
});

afterEach(() => {
  db.$client.close();
  vi.clearAllMocks();
});

it("rejects oversized HEIC before invoking the decoder or storing anything", async () => {
  const dataDir = await makeTempDir();
  const file = new File(
    [new Uint8Array(PROMPT_ATTACHMENT_MAX_BYTES + 1)],
    "huge.heic",
    { type: "image/heic" },
  );
  await expect(
    storeAttachment(db, dataDir, "project-heic-limit", file),
  ).rejects.toMatchObject({ status: 400 });
  expect(normalizeHeifAttachment).not.toHaveBeenCalled();
  expect(db.select().from(projectAttachments).all()).toEqual([]);
});

it("rejects an oversized converted PNG before storing anything", async () => {
  const dataDir = await makeTempDir();
  vi.mocked(normalizeHeifAttachment).mockResolvedValue(
    new File([new Uint8Array(PROMPT_ATTACHMENT_MAX_BYTES + 1)], "huge.png", {
      type: "image/png",
    }),
  );
  await expect(
    storeAttachment(
      db,
      dataDir,
      "project-heic-limit",
      new File(["heic"], "huge.heic", { type: "image/heic" }),
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(db.select().from(projectAttachments).all()).toEqual([]);
});
