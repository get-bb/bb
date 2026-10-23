import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  agentUpdateFromComposerRequest,
  AUTOMATION_PROJECT_FIXED_MESSAGE,
  AUTOMATION_PROMPT_PLUGIN_MENTION_MESSAGE,
  AUTOMATION_PROMPT_REQUIRED_MESSAGE,
  AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE,
  automationPromptFromComposerInput,
} from "../lib/composer-request.js";

function composerRequest(
  overrides: Partial<NewThreadRequest> = {},
): NewThreadRequest {
  return {
    projectId: "proj_kops",
    providerId: "claude-code",
    model: "claude-opus-5-5",
    reasoningLevel: "high",
    permissionMode: "auto",
    executionInputSources: {},
    environment: {
      type: "provider",
      environmentProviderId: "berth",
      inputs: { branch: { kind: "new", baseBranch: "dev" } },
    },
    input: [{ type: "text", text: "Triage the new issues", mentions: [] }],
    ...overrides,
  };
}

describe("automationPromptFromComposerInput", () => {
  it("writes thread, project and section mentions as their tokens", () => {
    const text = "Follow up on Fix login in Kops under Later, see @src/a.ts";
    expect(
      automationPromptFromComposerInput([
        {
          type: "text",
          text,
          mentions: [
            {
              start: text.indexOf("Fix login"),
              end: text.indexOf("Fix login") + "Fix login".length,
              resource: {
                kind: "thread",
                threadId: "thr_login",
                label: "Fix login",
              },
            },
            {
              start: text.indexOf("Kops"),
              end: text.indexOf("Kops") + "Kops".length,
              resource: {
                kind: "project",
                projectId: "proj_kops",
                label: "Kops",
              },
            },
            {
              start: text.indexOf("Later"),
              end: text.indexOf("Later") + "Later".length,
              resource: {
                kind: "section",
                sectionId: "sec_later",
                label: "Later",
              },
            },
            {
              start: text.indexOf("@src/a.ts"),
              end: text.length,
              resource: {
                kind: "path",
                source: "workspace",
                entryKind: "file",
                path: "src/a.ts",
                label: "@src/a.ts",
              },
            },
          ],
        },
      ]),
    ).toBe(
      "Follow up on @thread:thr_login in @project:proj_kops under @section:sec_later, see @src/a.ts",
    );
  });

  it("refuses an attachment instead of dropping it", () => {
    expect(() =>
      automationPromptFromComposerInput([
        { type: "text", text: "Compare with this", mentions: [] },
        { type: "localImage", path: "/tmp/screenshot.png" },
      ]),
    ).toThrow(AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE);
    expect(() =>
      automationPromptFromComposerInput([
        {
          type: "text",
          text: "Compare with shot.png",
          mentions: [
            {
              start: 13,
              end: 21,
              resource: {
                kind: "attachment",
                path: "/tmp/shot.png",
                label: "shot.png",
              },
            },
          ],
        },
      ]),
    ).toThrow(AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE);
  });

  it("refuses a plugin mention, whose context a run could not rebuild", () => {
    expect(() =>
      automationPromptFromComposerInput([
        {
          type: "text",
          text: "Triage ENG-12",
          mentions: [
            {
              start: 7,
              end: 13,
              resource: {
                kind: "plugin",
                pluginId: "linear",
                itemId: "ENG-12",
                label: "ENG-12",
              },
            },
          ],
        },
      ]),
    ).toThrow(AUTOMATION_PROMPT_PLUGIN_MENTION_MESSAGE);
  });
});

describe("agentUpdateFromComposerRequest", () => {
  it("replaces every execution choice and the environment", () => {
    expect(
      agentUpdateFromComposerRequest(
        composerRequest({
          serviceTier: "fast",
          sessionOptions: { "web-search": true },
        }),
        "proj_kops",
      ),
    ).toEqual({
      prompt: "Triage the new issues",
      providerId: "claude-code",
      model: "claude-opus-5-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "auto",
      sessionOptions: { "web-search": true },
      target: {
        type: "environment",
        environment: {
          type: "provider",
          environmentProviderId: "berth",
          inputs: { branch: { kind: "new", baseBranch: "dev" } },
        },
      },
    });
  });

  it("clears a service tier and agent options the request no longer carries", () => {
    expect(
      agentUpdateFromComposerRequest(
        composerRequest({ sessionOptions: {} }),
        "proj_kops",
      ),
    ).toMatchObject({ serviceTier: null, sessionOptions: null });
  });

  it("keeps following the project default", () => {
    expect(
      agentUpdateFromComposerRequest(
        composerRequest({ environment: { type: "project-default" } }),
        "proj_kops",
      ).target,
    ).toEqual({
      type: "environment",
      environment: { type: "project-default" },
    });
  });

  it("refuses a request for another project", () => {
    expect(() =>
      agentUpdateFromComposerRequest(
        composerRequest({ projectId: "proj_other" }),
        "proj_kops",
      ),
    ).toThrow(AUTOMATION_PROJECT_FIXED_MESSAGE);
  });

  it("refuses a prompt that is only whitespace", () => {
    expect(() =>
      agentUpdateFromComposerRequest(
        composerRequest({
          input: [{ type: "text", text: "  \n ", mentions: [] }],
        }),
        "proj_kops",
      ),
    ).toThrow(AUTOMATION_PROMPT_REQUIRED_MESSAGE);
  });
});
