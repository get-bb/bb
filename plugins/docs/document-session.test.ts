import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./proposals.js";
import {
  createDocumentSession,
  type DocumentSnapshot,
  type DocumentWriter,
} from "./document-session.js";

function snapshot(
  content = "Original\n",
  sha256 = "original-sha",
  proposal: Proposal | null = null,
): DocumentSnapshot {
  return {
    content,
    sha256,
    proposal,
    previewBaseUrl: "/preview",
    previewPath: "letter.md",
  };
}

function proposal(
  status: Proposal["status"] = "pending",
  version = 1,
): Proposal {
  return {
    vaultId: "personal",
    path: "letter.md",
    version,
    baseContent: "Original\n",
    baseSha256: "original-sha",
    content: "Candidate\n",
    status,
    resolvedSha256: status === "accepted" ? "accepted-sha" : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function writer(overrides: Partial<DocumentWriter> = {}) {
  let next = 0;
  const save = vi.fn<DocumentWriter["save"]>(async (path) => ({
    path,
    sha256: `saved-${(next += 1)}`,
  }));
  const refetch = vi.fn(async () => {});
  return {
    save,
    refetch,
    writer: {
      renamesToTitle: false,
      save,
      refetch,
      ...overrides,
    } satisfies DocumentWriter,
  };
}

function loaded(initial = snapshot(), io = writer(), showsProposals = false) {
  const session = createDocumentSession({
    path: "letter.md",
    showsProposals,
    delay: 500,
  });
  session.connect(io.writer);
  session.receive(initial);
  return { session, ...io };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Docs document sessions", () => {
  it("drains edits made during a save using the returned file hash", async () => {
    const first = deferred<{ path: string; sha256: string }>();
    const io = writer();
    io.save.mockImplementationOnce(() => first.promise);
    const { session, save } = loaded(snapshot(), io);
    session.edit("First\n");
    const flushing = session.flush();
    session.edit("Second\n");
    first.resolve({ path: "letter.md", sha256: "first-sha" });
    await flushing;
    expect(save.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["First\n", "original-sha"],
      ["Second\n", "first-sha"],
    ]);
    expect(session.getSnapshot()).toMatchObject({
      dirty: false,
      saving: false,
    });
  });

  it("keeps the draft and offers both versions when another writer saves during typing", async () => {
    const { session, save } = loaded(snapshot("Line\n", "base-sha"));
    session.edit("Line mine\n");
    const theirs = snapshot("Line theirs\n", "their-sha");
    session.receive(theirs);
    expect(session.getSnapshot()).toMatchObject({
      draft: "Line mine\n",
      conflict: theirs,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).not.toHaveBeenCalled();
    await session.keepMine();
    expect(save.mock.calls[0]?.slice(1, 3)).toEqual([
      "Line mine\n",
      "their-sha",
    ]);
    expect(session.getSnapshot().conflict).toBeNull();
  });

  it("replaces the draft with the other version when the user picks it", () => {
    const { session, save } = loaded(snapshot("Line\n", "base-sha"));
    session.edit("Line mine\n");
    session.receive(snapshot("Line theirs\n", "their-sha"));
    session.useTheirs();
    expect(session.getSnapshot()).toMatchObject({
      draft: "Line theirs\n",
      dirty: false,
      conflict: null,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("ignores the echo of its own save and stale reads from before it", async () => {
    const pending = deferred<{ path: string; sha256: string }>();
    const io = writer();
    io.save.mockImplementationOnce(() => pending.promise);
    const { session } = loaded(snapshot("Old\n", "old-sha"), io);
    session.edit("New\n");
    const flushing = session.flush();
    session.receive(snapshot("New\n", "new-sha"));
    session.edit("New and more\n");
    pending.resolve({ path: "letter.md", sha256: "new-sha" });
    await flushing;
    session.receive(snapshot("Old\n", "old-sha"));
    expect(session.getSnapshot()).toMatchObject({
      draft: "New and more\n",
      conflict: null,
    });
  });

  it("offers the newer file after a rejected save instead of retrying the stale one", async () => {
    const io = writer();
    io.save.mockRejectedValueOnce(
      new Error("This document changed elsewhere."),
    );
    const { session, save, refetch } = loaded(
      snapshot("A\n\nB\n", "base-sha"),
      io,
    );
    session.edit("A typed\n\nB\n");
    await session.flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    const theirs = snapshot("A\n\nB remote\n", "remote-sha");
    session.receive(theirs);
    expect(session.getSnapshot()).toMatchObject({
      draft: "A typed\n\nB\n",
      conflict: theirs,
      error: null,
    });
    await session.keepMine();
    expect(save.mock.calls.at(-1)?.slice(1, 3)).toEqual([
      "A typed\n\nB\n",
      "remote-sha",
    ]);
    expect(session.getSnapshot()).toMatchObject({
      conflict: null,
      error: null,
      dirty: false,
    });
  });

  it("stops saving a document that was moved or deleted elsewhere", async () => {
    const { session, save } = loaded();
    session.edit("Unsaved\n");
    session.receiveError("Path does not exist: letter.md");
    session.edit("Ignored\n");
    await vi.advanceTimersByTimeAsync(2_000);
    await session.flush();
    expect(save).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      missing: true,
      draft: "Unsaved\n",
    });
  });

  it("moves the session to the path a save renamed the document to", async () => {
    const onRename = vi.fn();
    const session = createDocumentSession({
      path: "draft.md",
      showsProposals: false,
      delay: 500,
      onRename,
    });
    const io = writer({ renamesToTitle: true });
    io.save.mockResolvedValueOnce({ path: "meeting-notes.md", sha256: "s1" });
    session.connect(io.writer);
    session.receive(snapshot("# Draft\n"));
    session.edit("# Meeting notes\n");
    await session.flush();
    expect(io.save.mock.calls[0]).toEqual([
      "draft.md",
      "# Meeting notes\n",
      "original-sha",
      true,
    ]);
    expect(session.getSnapshot().path).toBe("meeting-notes.md");
    expect(onRename).toHaveBeenCalledWith("draft.md", "meeting-notes.md");
  });

  it("flushes a candidate before accepting and waits for the accepted document", async () => {
    const updateProposal = vi.fn<NonNullable<DocumentWriter["updateProposal"]>>(
      async (_path, content, version) => ({
        ...proposal(),
        content,
        version: version + 1,
      }),
    );
    const resolveProposal = vi.fn<
      NonNullable<DocumentWriter["resolveProposal"]>
    >(async () => proposal("accepted", 3));
    const { session } = loaded(
      snapshot("Original\n", "original-sha", proposal()),
      writer({ updateProposal, resolveProposal }),
      true,
    );
    session.edit("Edited candidate\n");
    const resolving = session.resolve("accept");
    await resolving;
    expect(updateProposal).toHaveBeenCalledWith(
      "letter.md",
      "Edited candidate\n",
      1,
    );
    expect(resolveProposal).toHaveBeenCalledWith("letter.md", "accept", 2);
    expect(session.getSnapshot().busy).toBe(true);
    session.receive(
      snapshot("Edited candidate\n", "accepted-sha", proposal("pending", 2)),
    );
    expect(session.getSnapshot().busy).toBe(true);
    session.receive(
      snapshot("Edited candidate\n", "accepted-sha", proposal("accepted", 3)),
    );
    expect(session.getSnapshot()).toMatchObject({
      busy: false,
      draft: "Edited candidate\n",
      dirty: false,
    });
  });

  it("does not resolve a proposal when saving its candidate fails", async () => {
    const resolveProposal =
      vi.fn<NonNullable<DocumentWriter["resolveProposal"]>>();
    const { session } = loaded(
      snapshot("Original\n", "original-sha", proposal()),
      writer({
        updateProposal: async () => {
          throw new Error("The proposal changed.");
        },
        resolveProposal,
      }),
      true,
    );
    session.edit("Edited candidate\n");
    await session.resolve("accept");
    expect(resolveProposal).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      busy: false,
      error: "The proposal changed.",
      draft: "Edited candidate\n",
    });
  });
});
