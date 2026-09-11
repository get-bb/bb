import { describe, expect, it } from "vitest";
import { draftContentSchema } from "@bb/server-contract";
import type { NewThreadComposerSubmission } from "@/components/promptbox/NewThreadComposer";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";
import {
  ownsRootComposeLocation,
  replaceRootDraftOrigin,
  rootDraftComposerSeed,
  rootDraftSubmissionContent,
} from "./root-compose-draft";

const destination: PaneContent = {
  kind: "thread",
  projectId: "proj_origin",
  threadId: "thr_created",
};

function layout(focusedPaneId: string): SplitLayout {
  return {
    focusedPaneId,
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          type: "pane",
          paneId: "first",
          content: { kind: "new-thread", draftId: "drf_firstdraft" },
        },
        {
          type: "pane",
          paneId: "second",
          content: { kind: "new-thread", draftId: "drf_seconddraft" },
        },
      ],
    },
  };
}

const origin = { draftId: "drf_firstdraft", paneId: "first", hadLayout: true };

describe("root draft ownership", () => {
  it("consumes initial prompt and location seeds only for the focused draft matching the route", () => {
    const location = {
      pathname: "/",
      search: "?draft=drf_firstdraft&initialPrompt=hello",
    };
    expect(ownsRootComposeLocation("drf_firstdraft", true, location)).toBe(
      true,
    );
    expect(ownsRootComposeLocation("drf_firstdraft", false, location)).toBe(
      false,
    );
    expect(ownsRootComposeLocation("drf_seconddraft", true, location)).toBe(
      false,
    );
    expect(
      ownsRootComposeLocation("drf_firstdraft", true, {
        pathname: "/threads/thr_current",
        search: location.search,
      }),
    ).toBe(false);
  });

  it("replaces only the sending pane and preserves focus when another pane is selected during submission", () => {
    const current = layout("second");
    const result = replaceRootDraftOrigin({
      layout: current,
      origin,
      destination,
      currentRouteDraftId: "drf_seconddraft",
    });
    expect(result.navigate).toBe(false);
    expect(result.layout?.focusedPaneId).toBe("second");
    expect(result.layout?.root).toMatchObject({
      children: [
        { paneId: "first", content: destination },
        {
          paneId: "second",
          content: { kind: "new-thread", draftId: "drf_seconddraft" },
        },
      ],
    });
  });

  it("does not replace a closed or repurposed originating pane", () => {
    const current = layout("first");
    const changed = replaceRootDraftOrigin({
      layout: current,
      origin,
      destination: { kind: "new-thread", draftId: "drf_otherdraft" },
      currentRouteDraftId: origin.draftId,
    }).layout;
    const result = replaceRootDraftOrigin({
      layout: changed,
      origin,
      destination,
      currentRouteDraftId: "drf_otherdraft",
    });
    expect(result).toEqual({ layout: changed, navigate: false });
    expect(
      replaceRootDraftOrigin({
        layout: current,
        origin: { ...origin, paneId: "closed" },
        destination,
        currentRouteDraftId: origin.draftId,
      }),
    ).toEqual({ layout: current, navigate: false });
    expect(
      replaceRootDraftOrigin({
        layout: null,
        origin,
        destination,
        currentRouteDraftId: origin.draftId,
      }),
    ).toEqual({ layout: null, navigate: false });
  });

  it("navigates a canonical unsplit root only while its original draft still owns the URL", () => {
    const canonical = { ...origin, paneId: null, hadLayout: false };
    expect(
      replaceRootDraftOrigin({
        layout: null,
        origin: canonical,
        destination,
        currentRouteDraftId: origin.draftId,
      }).navigate,
    ).toBe(true);
    expect(
      replaceRootDraftOrigin({
        layout: null,
        origin: canonical,
        destination,
        currentRouteDraftId: "drf_seconddraft",
      }).navigate,
    ).toBe(false);
    expect(
      replaceRootDraftOrigin({
        layout: layout("second"),
        origin: canonical,
        destination,
        currentRouteDraftId: origin.draftId,
      }).navigate,
    ).toBe(false);
  });
});

describe("root draft content", () => {
  it("restores unavailable choices without replacing them with another draft's defaults", () => {
    const content = draftContentSchema.parse({
      projectId: "proj_removed",
      options: {
        providerId: "provider_removed",
        model: "model_removed",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
        environment: {
          type: "provider",
          environmentProviderId: "environment_removed",
          machine: null,
          inputs: null,
        },
      },
    });
    expect(rootDraftComposerSeed(content.options)).toMatchObject({
      providerId: "provider_removed",
      model: "model_removed",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      environment: content.options.environment,
    });
    expect(content.projectId).toBe("proj_removed");
  });

  it("copies submitted choices while preserving destination, fork metadata, and the current prompt", () => {
    const content = draftContentSchema.parse({
      projectId: null,
      sectionId: "section_saved",
      prompt: { text: "Current text" },
      options: {
        sourceThreadId: "thr_source",
        sourceSeqEnd: 12,
        originKind: "fork",
        title: "Saved title",
      },
    });
    const request: NewThreadComposerSubmission = {
      projectId: "proj_fallback",
      providerId: "provider_selected",
      model: "model_selected",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      environment: { type: "reuse", environmentId: "env_saved" },
      executionInputSources: {},
      input: [],
      sendAt: 1000,
    };
    const result = rootDraftSubmissionContent(content, request);
    expect(result.projectId).toBeNull();
    expect(result.sectionId).toBe("section_saved");
    expect(result.prompt.text).toBe("Current text");
    expect(result.options).toMatchObject({
      sourceThreadId: "thr_source",
      sourceSeqEnd: 12,
      originKind: "fork",
      title: "Saved title",
      model: "model_selected",
      sendAt: 1000,
    });
  });
});
