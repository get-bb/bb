import {
  createDraftSubmissionReceipt,
  getDraftSubmissionReceipt,
  getStoredDraft,
  getThread,
  listThreads,
} from "@bb/db";
import {
  draftCreateResponseSchema,
  draftListResponseSchema,
  draftSchema,
  draftSubmitResponseSchema,
  type Draft,
  type DraftContentInput,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function request(
  harness: TestAppHarness,
  path: string,
  method: string,
  body: unknown,
) {
  return harness.app.request(`/api/v1/drafts${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function create(
  harness: TestAppHarness,
  content: DraftContentInput = {},
  id?: string,
): Promise<Draft> {
  const response = await request(harness, "", "POST", { id, content });
  expect(response.status).toBe(201);
  const { draft } = draftCreateResponseSchema.parse(await readJson(response));
  if (draft === null) throw new Error("Expected a new draft");
  return draft;
}

function readyContent(harness: TestAppHarness): DraftContentInput {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    projectId: project.id,
    hostId: host.id,
  });
  return {
    projectId: project.id,
    prompt: { text: "Keep the accepted snapshot" },
    options: {
      providerId: "codex",
      model: "gpt-5",
      environment: { type: "reuse", environmentId: environment.id },
      sendAt: Date.now() + 86_400_000,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setPluginHookProvider(undefined);
  setPluginEnvironmentProviderBridge(undefined);
});

describe("durable draft resources", () => {
  it("keeps incomplete independent contents and filters saved drafts", async () => {
    await withTestHarness(async (harness) => {
      const first = await create(harness, {
        projectId: "proj_unavailable",
        sectionId: "section_unavailable",
        prompt: { text: "Release plan" },
        options: {
          providerId: "removed-provider",
          environment: {
            type: "provider",
            environmentProviderId: "removed-environment",
            machine: null,
            inputs: { branch: "topic" },
          },
        },
      });
      const second = await create(harness, { prompt: { text: "Other work" } });
      const empty = await create(harness);
      expect(new Set([first.id, second.id, empty.id]).size).toBe(3);
      const response = await harness.app.request(
        "/api/v1/drafts?query=release&projectId=proj_unavailable",
      );
      expect(
        draftListResponseSchema.parse(await readJson(response)).drafts,
      ).toEqual([first]);
      const all = draftListResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/drafts")),
      );
      expect(all.drafts.map((draft) => draft.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      const withEmpty = draftListResponseSchema.parse(
        await readJson(
          await harness.app.request("/api/v1/drafts?includeEmpty=true"),
        ),
      );
      expect(withEmpty.drafts).toHaveLength(3);
      const submit = await request(harness, `/${first.id}/submit`, "POST", {
        expectedRevision: 1,
      });
      expect(submit.status).toBe(400);
      expect(
        draftSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/drafts/${first.id}`),
          ),
        ),
      ).toEqual(first);
    });
  });

  it("acknowledges singleton import retries without reverting edits or resurrecting consumed data", async () => {
    await withTestHarness(async (harness) => {
      const content = { prompt: { text: "Legacy singleton" } };
      const draft = await create(harness, content, "drf_legacy_singleton");
      const newerContent = {
        ...draft.content,
        prompt: { ...draft.content.prompt, text: "Newer server edit" },
      };
      const update = await request(harness, `/${draft.id}`, "PATCH", {
        expectedRevision: 1,
        content: newerContent,
      });
      expect(update.status).toBe(200);
      const replay = await create(harness, content, draft.id);
      expect(replay.content.prompt.text).toBe("Newer server edit");
      expect(replay.revision).toBe(2);
      const collision = await request(harness, "", "POST", {
        id: draft.id,
        content: newerContent,
      });
      expect(collision.status).toBe(409);
      expect(
        (
          await request(harness, `/${draft.id}`, "DELETE", {
            expectedRevision: 2,
          })
        ).status,
      ).toBe(200);
      const acknowledged = await request(harness, "", "POST", {
        id: draft.id,
        content,
      });
      expect(
        draftCreateResponseSchema.parse(await readJson(acknowledged)),
      ).toEqual({ id: draft.id, draft: null });
      expect(getStoredDraft(harness.db, draft.id)?.payloadJson).toBeNull();
    });
  });

  it("rejects stale writes, deletion and submission without losing the winning edit", async () => {
    await withTestHarness(async (harness) => {
      const draft = await create(harness, { prompt: { text: "Original" } });
      const content = {
        ...draft.content,
        prompt: { ...draft.content.prompt, text: "Winner" },
      };
      expect(
        (
          await request(harness, `/${draft.id}`, "PATCH", {
            expectedRevision: 1,
            content,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(harness, `/${draft.id}`, "PATCH", {
            expectedRevision: 1,
            content: draft.content,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(harness, `/${draft.id}`, "DELETE", {
            expectedRevision: 1,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(harness, `/${draft.id}/submit`, "POST", {
            expectedRevision: 1,
          })
        ).status,
      ).toBe(409);
      const current = draftSchema.parse(
        await readJson(await harness.app.request(`/api/v1/drafts/${draft.id}`)),
      );
      expect(current.content.prompt.text).toBe("Winner");
      expect(current.revision).toBe(2);
    });
  });

  it("submits provider-owned machine selections through the existing creation contract", async () => {
    await withTestHarness(async (harness) => {
      const ready = readyContent(harness);
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [],
        getEnvironmentProvider: () => undefined,
        listEnvironmentCompositions: () => [
          {
            pluginId: "draft-machine-fixture",
            composition: {
              id: "draft-machine-fixture",
              displayName: "Draft machine fixture",
              description: "Prepare a workspace for this draft.",
              icon: "Cloud",
              machineProviderId: "fixture-machine",
              environmentProviderId: "project-checkout",
            },
          },
        ],
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const draft = await create(harness, {
        ...ready,
        options: {
          ...ready.options,
          environment: {
            type: "provider",
            environmentProviderId: "draft-machine-fixture",
            inputs: null,
          },
        },
      });
      expect(draft.content.options.environment).toMatchObject({
        machine: null,
      });
      const response = await request(harness, `/${draft.id}/submit`, "POST", {
        expectedRevision: draft.revision,
      });
      expect(response.status).toBe(200);
      expect(
        draftSubmitResponseSchema.parse(await readJson(response)).draft,
      ).toBeNull();
    });
  });

  it("submits concurrent and retried requests once without consuming a second draft", async () => {
    await withTestHarness(async (harness) => {
      const draft = await create(harness, readyContent(harness));
      const other = await create(harness, {
        prompt: { text: "Do not consume" },
      });
      const submit = () =>
        request(harness, `/${draft.id}/submit`, "POST", {
          expectedRevision: draft.revision,
        });
      const responses = await Promise.all([submit(), submit()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const results = await Promise.all(
        responses.map(async (response) =>
          draftSubmitResponseSchema.parse(await readJson(response)),
        ),
      );
      const replay = draftSubmitResponseSchema.parse(
        await readJson(await submit()),
      );
      expect(results[0]?.thread.id).toBe(results[1]?.thread.id);
      expect(replay.thread.id).toBe(results[0]?.thread.id);
      expect(replay.draft).toBeNull();
      expect(
        listThreads(harness.db, { projectId: draft.content.projectId! }),
      ).toHaveLength(1);
      expect(
        (await harness.app.request(`/api/v1/drafts/${draft.id}`)).status,
      ).toBe(410);
      expect(
        draftSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/drafts/${other.id}`),
          ),
        ),
      ).toEqual(other);
    });
  });

  it("rechecks the revision after asynchronous creation preflight", async () => {
    await withTestHarness(async (harness) => {
      const draft = await create(harness, readyContent(harness));
      let release = () => {};
      let entered = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(
        harness.deps.providerRegistry,
        "whenRegistrationsSettled",
      ).mockImplementationOnce(async () => {
        entered();
        await blocked;
      });
      const submitting = request(harness, `/${draft.id}/submit`, "POST", {
        expectedRevision: 1,
      });
      await started;
      try {
        const content = {
          ...draft.content,
          prompt: { ...draft.content.prompt, text: "Edited during submit" },
        };
        expect(
          (
            await request(harness, `/${draft.id}`, "PATCH", {
              expectedRevision: 1,
              content,
            })
          ).status,
        ).toBe(200);
      } finally {
        release();
      }
      expect((await submitting).status).toBe(409);
      expect(
        listThreads(harness.db, { projectId: draft.content.projectId! }),
      ).toHaveLength(0);
    });
  });

  it("preserves newer contents saved after the thread is reserved", async () => {
    await withTestHarness(async (harness) => {
      const content = readyContent(harness);
      const draft = await create(harness, {
        ...content,
        options: { ...content.options, sendAt: null },
      });
      let release = () => {};
      let entered = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const registry: { [K in PluginHookName]: PluginHookRegistration<K>[] } = {
        "message.dispatch": [
          {
            pluginId: "draft-test",
            handler: async () => {
              entered();
              await blocked;
              return { action: "proceed" };
            },
          },
        ],
      };
      setPluginHookProvider({
        listHooks: (hook) => registry[hook],
        invokeHook: async (_id, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const submitting = request(harness, `/${draft.id}/submit`, "POST", {
        expectedRevision: 1,
      });
      await started;
      const newer = {
        ...draft.content,
        prompt: { ...draft.content.prompt, text: "Keep this newer edit" },
      };
      try {
        expect(
          (
            await request(harness, `/${draft.id}`, "PATCH", {
              expectedRevision: 1,
              content: newer,
            })
          ).status,
        ).toBe(200);
      } finally {
        release();
      }
      const response = await submitting;
      expect(response.status).toBe(200);
      const result = draftSubmitResponseSchema.parse(await readJson(response));
      expect(result.draft?.revision).toBe(2);
      expect(result.draft?.content).toEqual(newer);
      expect(
        getDraftSubmissionReceipt(harness.db, {
          draftId: draft.id,
          revision: 1,
        })?.status,
      ).toBe("submitted");
    });
  });

  it("recovers interrupted reservations without duplicating threads or dropping the draft", async () => {
    await withTestHarness(async (harness) => {
      const draft = await create(harness, readyContent(harness));
      const thread = seedThread(harness.deps, {
        projectId: draft.content.projectId!,
        status: "pending",
      });
      createDraftSubmissionReceipt(harness.db, {
        draftId: draft.id,
        revision: 1,
        threadId: thread.id,
      });
      const response = await request(harness, `/${draft.id}/submit`, "POST", {
        expectedRevision: 1,
      });
      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(getStoredDraft(harness.db, draft.id)?.payloadJson).not.toBeNull();
      expect(
        (
          await request(harness, `/${draft.id}/submit`, "POST", {
            expectedRevision: 1,
          })
        ).status,
      ).toBe(409);
      expect(
        listThreads(harness.db, { projectId: draft.content.projectId! }),
      ).toHaveLength(0);
    });
  });

  it("preserves rejected submissions and requires a new revision for an intentional retry", async () => {
    await withTestHarness(async (harness) => {
      const content = readyContent(harness);
      const draft = await create(harness, {
        ...content,
        options: { ...content.options, sendAt: null },
      });
      const registry: { [K in PluginHookName]: PluginHookRegistration<K>[] } = {
        "message.dispatch": [
          {
            pluginId: "draft-test",
            handler: () => ({
              action: "reject",
              message: "Temporarily blocked",
            }),
          },
        ],
      };
      setPluginHookProvider({
        listHooks: (hook) => registry[hook],
        invokeHook: async (_id, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const submit = () =>
        request(harness, `/${draft.id}/submit`, "POST", {
          expectedRevision: 1,
        });
      expect((await submit()).status).toBe(409);
      expect(
        getDraftSubmissionReceipt(harness.db, {
          draftId: draft.id,
          revision: 1,
        })?.status,
      ).toBe("failed");
      setPluginHookProvider(undefined);
      setPluginEnvironmentProviderBridge(undefined);
      expect((await submit()).status).toBe(409);
      expect(
        listThreads(harness.db, { projectId: draft.content.projectId! }),
      ).toHaveLength(0);
      expect(
        (
          await request(harness, `/${draft.id}`, "PATCH", {
            expectedRevision: 1,
            content: draft.content,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(harness, `/${draft.id}/submit`, "POST", {
            expectedRevision: 2,
          })
        ).status,
      ).toBe(200);
      expect(
        listThreads(harness.db, { projectId: draft.content.projectId! }),
      ).toHaveLength(1);
    });
  });

  it("enforces the existing browser-origin guard for draft access", async () => {
    await withTestHarness(async (harness) => {
      const draft = await create(harness, {
        prompt: { text: "Private draft" },
      });
      for (const path of ["", `/${draft.id}`]) {
        const response = await harness.app.request(`/api/v1/drafts${path}`, {
          headers: { origin: "https://untrusted.example" },
        });
        expect(response.status).toBe(403);
      }
      const response = await harness.app.request(`/api/v1/drafts/${draft.id}`, {
        method: "DELETE",
        headers: {
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: 1 }),
      });
      expect(response.status).toBe(403);
      expect(getStoredDraft(harness.db, draft.id)?.deletedAt).toBeNull();
    });
  });
});
