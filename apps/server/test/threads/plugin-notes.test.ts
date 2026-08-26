import { listEvents } from "@bb/db";
import {
  PLUGIN_NOTE_TEXT_MAX_LENGTH,
  type SystemPluginNoteEventData,
} from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { INHERITED_EVENT_TYPES } from "../../src/services/threads/thread-fork-history.js";
import {
  PLUGIN_NOTE_RATE_LIMIT,
  appendPluginNote,
  resetPluginNoteRateLimits,
} from "../../src/services/threads/plugin-notes.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/plugin-notes-project";

afterEach(() => {
  resetPluginNoteRateLimits();
});

function seedNotableThread(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
}

function noteEvents(
  harness: TestAppHarness,
  threadId: string,
): SystemPluginNoteEventData[] {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/plugin-note")
    .map((event) => JSON.parse(event.data) as SystemPluginNoteEventData);
}

describe("plugin notes", () => {
  it("records the note with the caller's plugin id, not the note's", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedNotableThread(harness, "host-note");

      appendPluginNote(harness.deps, {
        pluginId: "provider-retry",
        threadId: thread.id,
        note: {
          text: "Rate limited — retrying at 6:30",
          iconName: "Clock",
          level: "warning",
        },
      });

      expect(noteEvents(harness, thread.id)).toEqual([
        {
          pluginId: "provider-retry",
          text: "Rate limited — retrying at 6:30",
          iconName: "Clock",
          level: "warning",
        },
      ]);
    });
  });

  it("defaults an unlevelled note to info and refuses an empty or oversized one", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedNotableThread(harness, "host-note-validate");

      appendPluginNote(harness.deps, {
        pluginId: "provider-retry",
        threadId: thread.id,
        note: { text: "Retrying" },
      });
      expect(noteEvents(harness, thread.id)[0]?.level).toBe("info");

      expect(() =>
        appendPluginNote(harness.deps, {
          pluginId: "provider-retry",
          threadId: thread.id,
          note: { text: "   " },
        }),
      ).toThrow(/note is invalid/u);
      expect(() =>
        appendPluginNote(harness.deps, {
          pluginId: "provider-retry",
          threadId: thread.id,
          note: { text: "x".repeat(PLUGIN_NOTE_TEXT_MAX_LENGTH + 1) },
        }),
      ).toThrow(/note is invalid/u);
      // A rejected note is not a written note.
      expect(noteEvents(harness, thread.id)).toHaveLength(1);
    });
  });

  it("refuses a note on a thread that does not exist", async () => {
    await withTestHarness(async (harness) => {
      expect(() =>
        appendPluginNote(harness.deps, {
          pluginId: "provider-retry",
          threadId: "thr_missing",
          note: { text: "Retrying" },
        }),
      ).toThrow(ApiError);
    });
  });

  it("rate limits one plugin on one thread without silencing others", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedNotableThread(harness, "host-note-limit");
      const other = seedNotableThread(harness, "host-note-limit-2");

      for (let i = 0; i < PLUGIN_NOTE_RATE_LIMIT; i += 1) {
        appendPluginNote(harness.deps, {
          pluginId: "chatty",
          threadId: thread.id,
          note: { text: `Note ${i}` },
        });
      }
      expect(() =>
        appendPluginNote(harness.deps, {
          pluginId: "chatty",
          threadId: thread.id,
          note: { text: "One too many" },
        }),
      ).toThrow(/rate limit exceeded/u);
      expect(noteEvents(harness, thread.id)).toHaveLength(
        PLUGIN_NOTE_RATE_LIMIT,
      );

      // The budget is per plugin per thread: a different plugin on the same
      // thread, and the same plugin on a different thread, are both unaffected.
      appendPluginNote(harness.deps, {
        pluginId: "quiet",
        threadId: thread.id,
        note: { text: "Still allowed" },
      });
      appendPluginNote(harness.deps, {
        pluginId: "chatty",
        threadId: other.id,
        note: { text: "Still allowed" },
      });
      expect(noteEvents(harness, thread.id)).toHaveLength(
        PLUGIN_NOTE_RATE_LIMIT + 1,
      );
      expect(noteEvents(harness, other.id)).toHaveLength(1);
    });
  });

  it("is excluded from everything a provider can see", () => {
    // A fork is the one place core copies history forward, and it copies an
    // explicit allowlist of conversation events. A note is not on it, so it
    // cannot travel into a forked thread — and nothing else renders a
    // transcript for a provider at all (a turn command carries prompt blocks
    // and the provider resumes its own session by id), which is what makes
    // notes display-only by construction rather than by policy.
    expect(INHERITED_EVENT_TYPES).not.toContain("system/plugin-note");
  });
});
