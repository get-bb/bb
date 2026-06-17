import {
  createConnection,
  createProject,
  createThread,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  assertValidParentThread,
  isAgentDelegatedChildThread,
  MAX_THREAD_HIERARCHY_DEPTH,
} from "../../src/services/threads/thread-parent.js";

type ThrowingCallback = () => void;

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: {
      hostId: host.id,
      path: "/tmp/thread-parent-test",
      type: "local_path",
    },
  });
  return { db, project };
}

function captureApiError(callback: ThrowingCallback): ApiError {
  try {
    callback();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected ApiError");
}

describe("thread parent validation", () => {
  it("accepts live standard parent threads", () => {
    const { db, project } = setup();
    const parentThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const validatedParent = assertValidParentThread(
      { db },
      {
        parentThreadId: parentThread.id,
        projectId: project.id,
      },
    );

    expect(validatedParent.id).toBe(parentThread.id);
  });

  it("rejects self-parenting", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const error = captureApiError(() => {
      assertValidParentThread(
        { db },
        {
          childThreadId: thread.id,
          parentThreadId: thread.id,
          projectId: project.id,
        },
      );
    });

    expect(error.body.details).toEqual({
      reason: "self",
      subject: "parent",
    });
  });

  it("rejects parent assignments that would create a cycle", () => {
    const { db, project } = setup();
    const rootThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const childThread = createThread(db, noopNotifier, {
      parentThreadId: rootThread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const grandchildThread = createThread(db, noopNotifier, {
      parentThreadId: childThread.id,
      projectId: project.id,
      providerId: "codex",
    });

    const error = captureApiError(() => {
      assertValidParentThread(
        { db },
        {
          childThreadId: rootThread.id,
          parentThreadId: grandchildThread.id,
          projectId: project.id,
        },
      );
    });

    expect(error.body.details).toEqual({
      reason: "cycle",
      subject: "parent",
    });
  });

  it("allows nesting up to the configured depth cap", () => {
    const { db, project } = setup();
    const rootThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const level2Thread = createThread(db, noopNotifier, {
      parentThreadId: rootThread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const level3Thread = createThread(db, noopNotifier, {
      parentThreadId: level2Thread.id,
      projectId: project.id,
      providerId: "codex",
    });

    const validatedParent = assertValidParentThread(
      { db },
      {
        parentThreadId: level3Thread.id,
        projectId: project.id,
      },
    );

    expect(validatedParent.id).toBe(level3Thread.id);
    expect(MAX_THREAD_HIERARCHY_DEPTH).toBe(4);
  });

  it("rejects new children beyond the configured depth cap", () => {
    const { db, project } = setup();
    const rootThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const level2Thread = createThread(db, noopNotifier, {
      parentThreadId: rootThread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const level3Thread = createThread(db, noopNotifier, {
      parentThreadId: level2Thread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const level4Thread = createThread(db, noopNotifier, {
      parentThreadId: level3Thread.id,
      projectId: project.id,
      providerId: "codex",
    });

    const error = captureApiError(() => {
      assertValidParentThread(
        { db },
        {
          parentThreadId: level4Thread.id,
          projectId: project.id,
        },
      );
    });

    expect(error.body.details).toEqual({
      reason: "too_deep",
      subject: "parent",
    });
  });

  it("rejects moves whose existing descendants would exceed the depth cap", () => {
    const { db, project } = setup();
    const rootThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const level2Thread = createThread(db, noopNotifier, {
      parentThreadId: rootThread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const level3Thread = createThread(db, noopNotifier, {
      parentThreadId: level2Thread.id,
      projectId: project.id,
      providerId: "codex",
    });
    const movingThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      parentThreadId: movingThread.id,
      projectId: project.id,
      providerId: "codex",
    });

    const error = captureApiError(() => {
      assertValidParentThread(
        { db },
        {
          childThreadId: movingThread.id,
          parentThreadId: level3Thread.id,
          projectId: project.id,
        },
      );
    });

    expect(error.body.details).toEqual({
      reason: "too_deep",
      subject: "parent",
    });
  });
});

describe("isAgentDelegatedChildThread", () => {
  it("is true for a thread with a parent", () => {
    expect(
      isAgentDelegatedChildThread({
        parentThreadId: "thr_parent",
      }),
    ).toBe(true);
  });

  it("is false for a fork-style root", () => {
    expect(
      isAgentDelegatedChildThread({
        parentThreadId: null,
      }),
    ).toBe(false);
  });

  it("is false for a root thread with no parent", () => {
    expect(
      isAgentDelegatedChildThread({
        parentThreadId: null,
      }),
    ).toBe(false);
  });
});
