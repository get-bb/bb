import { describe, expect, it } from "vitest";
import { draftContentSchema, type Draft } from "@bb/server-contract";
import type { RecoverableDraftSnapshot } from "./resource-store";
import { getDraftDisplayTitle, mergeDraftListEntries } from "./draft-list";

function draft(id: string, text: string, updatedAt: number): Draft {
  return {
    id,
    content: draftContentSchema.parse({ prompt: { text } }),
    revision: 1,
    createdAt: 1,
    updatedAt,
  };
}

function recovered(remote: Draft): RecoverableDraftSnapshot {
  return {
    id: remote.id,
    content: remote.content,
    updatedAt: remote.updatedAt,
    status: "error",
    error: new Error("Offline"),
    persistenceError: null,
  };
}

describe("draft discovery", () => {
  it("keeps a closed unsaved draft visible and gives its newer local content precedence", () => {
    const remote = draft("drf_existingdraft", "Saved text", 3);
    const pending = recovered(draft(remote.id, "Unsaved edits", 8));
    const missingProject = recovered(
      draft("drf_missingproject", "Keep this project", 10),
    );
    missingProject.content.projectId = "proj_deleted";
    const result = mergeDraftListEntries(
      [remote, draft("drf_olderdraft", "Older", 1)],
      [pending, missingProject],
    );
    expect(result.map((entry) => entry.id)).toEqual([
      missingProject.id,
      remote.id,
      "drf_olderdraft",
    ]);
    expect(result[0]?.content.projectId).toBe("proj_deleted");
    expect(result[1]?.content.prompt.text).toBe("Unsaved edits");
    expect(result[1]?.recoveryStatus).toBe("error");
  });

  it("excludes option-only blank drafts but keeps whitespace and attachments", () => {
    const blank = draft("drf_blankdraft", "", 9);
    blank.content.options.model = "model-selection";
    const whitespace = draft("drf_whitespacedraft", " ", 8);
    const attachment = draft("drf_attachmentdraft", "", 7);
    attachment.content.prompt.attachments = [
      {
        type: "localFile",
        path: "uploads/notes.txt",
        name: "notes.txt",
        sizeBytes: 100,
      },
    ];
    const result = mergeDraftListEntries([blank, whitespace, attachment], []);
    expect(result.map((entry) => entry.id)).toEqual([
      whitespace.id,
      attachment.id,
    ]);
    expect(getDraftDisplayTitle(attachment)).toBe("notes.txt");
    expect(getDraftDisplayTitle(whitespace)).toBe("Untitled draft");
  });

  it("preserves recovery for a deleted server identity without allocating a replacement", () => {
    const local = recovered(draft("drf_deleteddraft", "Recover this", 5));
    local.status = "deleted";
    expect(mergeDraftListEntries([], [local])).toMatchObject([
      { id: local.id, recoveryStatus: "deleted" },
    ]);
  });
});
