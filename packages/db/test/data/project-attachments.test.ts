import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  claimUnreadyProjectAttachmentDeletion,
  getProjectAttachment,
  recordProjectAttachment,
} from "../../src/data/project-attachments.js";
import { createMigratedConnection } from "../../src/testing.js";

describe("project attachments data", () => {
  it("claims a failed write's unready row for deletion but never a ready attachment", () => {
    const db = createMigratedConnection();
    const host = upsertHost(db, noopNotifier, { name: "attachments-host" });
    const { project } = createProject(db, noopNotifier, {
      name: "attachments",
      source: { type: "local_path", hostId: host.id, path: "/tmp/attachments" },
    });
    const record = (storedPath: string, readyAt: number | null) =>
      recordProjectAttachment(db, {
        projectId: project.id,
        storedPath,
        originalName: storedPath,
        mimeType: "text/plain",
        sizeBytes: 5,
        createdAt: 1_000,
        readyAt,
      });
    const failed = record("failed.txt", null);
    const ready = record("ready.txt", 2_000);

    claimUnreadyProjectAttachmentDeletion(db, {
      attachmentId: failed.id,
      claimedAt: 3_000,
    });
    claimUnreadyProjectAttachmentDeletion(db, {
      attachmentId: ready.id,
      claimedAt: 3_000,
    });

    expect(
      getProjectAttachment(db, project.id, "failed.txt")?.deletionClaimedAt,
    ).toBe(3_000);
    expect(
      getProjectAttachment(db, project.id, "ready.txt")?.deletionClaimedAt,
    ).toBeNull();
    db.$client.close();
  });
});
