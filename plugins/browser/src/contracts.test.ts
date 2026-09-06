import { describe, expect, it } from "vitest";
import type {
  BrowserControlAction,
  BrowserTabDescriptor,
  BrowserTabOwnerDescriptor,
  BrowserTabTarget,
  JsonValue,
} from "@bb/server-contract";
import type {
  PluginAgentToolContext,
  PluginBrowserOpenOptions,
} from "@get-bb/plugin-sdk";
import {
  browserOperationSchema,
  executeBrowserOperation,
} from "./contracts.js";

const target: BrowserTabTarget = {
  clientId: "client-a",
  windowId: "window-a",
  tabId: "tab-a",
  navigationEpoch: 4,
};

const tab: BrowserTabDescriptor = {
  ...target,
  threadId: "thread-a",
  projectId: "project-a",
  url: "https://example.com",
  title: "Example",
  connected: true,
  active: true,
};

const owner: BrowserTabOwnerDescriptor = {
  active: true,
  clientId: target.clientId,
  windowId: target.windowId,
  ownerId: "owner-a",
  threadId: tab.threadId,
  projectId: tab.projectId,
};

const agentContext: PluginAgentToolContext = {
  threadId: "thread-a",
  projectId: "project-a",
  signal: new AbortController().signal,
};

describe("Browser operation contract", () => {
  it("rejects standalone scripts exceeding canonical byte limits", () => {
    expect(
      browserOperationSchema.safeParse({
        operation: "script",
        target,
        code: "return input",
        input: "x".repeat(65_537),
      }).success,
    ).toBe(false);
    expect(
      browserOperationSchema.safeParse({
        operation: "script",
        target,
        code: "界".repeat(30_000),
        input: null,
      }).success,
    ).toBe(false);
    expect(
      browserOperationSchema.safeParse({
        operation: "script",
        target,
        code: "return input",
        input: { callback: () => 1 },
      }).success,
    ).toBe(false);
  });

  it("routes agent operations through the native browser service", async () => {
    const calls: Array<{
      target: BrowserTabTarget;
      action: BrowserControlAction;
      timeoutMs: number | undefined;
    }> = [];
    const openCalls: Array<{
      url: string;
      options: PluginBrowserOpenOptions;
    }> = [];
    const listTabsFilters: Array<{
      threadId?: string;
      projectId?: string;
      active?: boolean;
    }> = [];
    const listOwnerFilters: Array<{
      threadId?: string;
      projectId?: string;
      active?: boolean;
    }> = [];
    const browser = {
      experimental_browser: {
        listTabs(
          _context: PluginAgentToolContext,
          filter?: { threadId?: string; projectId?: string; active?: boolean },
        ) {
          listTabsFilters.push(filter ?? {});
          return [tab];
        },
        listOwners(
          _context: PluginAgentToolContext,
          filter?: { threadId?: string; projectId?: string; active?: boolean },
        ) {
          listOwnerFilters.push(filter ?? {});
          return [owner];
        },
        async openTab(
          _context: PluginAgentToolContext,
          url: string,
          options: PluginBrowserOpenOptions = {},
        ): Promise<BrowserTabTarget> {
          openCalls.push({ url, options });
          return target;
        },
        async run(
          nextTarget: BrowserTabTarget,
          action: BrowserControlAction,
          options: {
            context: PluginAgentToolContext;
            timeoutMs?: number;
          },
        ) {
          calls.push({
            target: nextTarget,
            action,
            timeoutMs: options.timeoutMs,
          });
          return { captured: true };
        },
        async experimental_requestContribution(
          nextTarget: BrowserTabTarget,
          _options: { controllerId: string; input: JsonValue },
          contributionOptions: {
            context: PluginAgentToolContext;
            timeoutMs?: number;
          },
        ) {
          calls.push({
            target: nextTarget,
            action: { kind: "snapshot", mode: "interactive" },
            timeoutMs: contributionOptions.timeoutMs,
          });
          return { captured: true };
        },
      },
    };
    const operation = browserOperationSchema.parse({
      operation: "run",
      target,
      action: { kind: "snapshot", mode: "interactive" },
    });

    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation,
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: browserOperationSchema.parse({ operation: "list" }),
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: browserOperationSchema.parse({
        operation: "open",
        projectId: "project-b",
        threadId: "thread-b",
        url: "file:///Users/test/page.html",
      }),
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      defaultHomepageUrl: "https://search.example/",
      operation: browserOperationSchema.parse({
        operation: "open",
      }),
    });

    expect(listTabsFilters).toEqual([
      { threadId: "thread-a", projectId: "project-a" },
    ]);
    expect(listOwnerFilters).toEqual([
      { threadId: "thread-a", projectId: "project-a" },
    ]);
    expect(calls).toEqual([
      {
        target,
        action: { kind: "snapshot", mode: "interactive" },
        timeoutMs: undefined,
      },
    ]);
    expect(openCalls).toEqual([
      {
        url: "file:///Users/test/page.html",
        options: { projectId: "project-b", threadId: "thread-b" },
      },
      { url: "https://search.example/", options: {} },
    ]);
  });

  it("forwards frame, world, and non-null input for a standalone script", async () => {
    const calls: Array<{ action: BrowserControlAction }> = [];
    const browser = {
      experimental_browser: {
        listTabs: () => [],
        listOwners: () => [],
        async openTab() {
          return target;
        },
        async run(_nextTarget: BrowserTabTarget, action: BrowserControlAction) {
          calls.push({ action });
          return { ran: true };
        },
        async experimental_requestContribution() {
          return null;
        },
      },
    };
    const parsed = browserOperationSchema.parse({
      operation: "script",
      target,
      code: "() => ({ ok: true })",
      frame: { frameId: "child-frame-1", documentEpoch: 7 },
      world: "main",
      input: { hello: "world" },
      timeoutMs: 400,
    });
    const result = await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: parsed,
    });
    expect(result).toEqual({ ran: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toEqual({
      kind: "script",
      source: "() => ({ ok: true })",
      frame: { frameId: "child-frame-1", documentEpoch: 7 },
      world: "main",
      input: { hello: "world" },
      timeoutMs: 400,
    });
  });

  it("rejects ambiguous agent targets before service dispatch", () => {
    expect(
      browserOperationSchema.safeParse({
        operation: "run",
        target: {
          clientId: target.clientId,
          windowId: target.windowId,
          tabId: target.tabId,
        },
        action: { kind: "snapshot", mode: "interactive" },
      }).success,
    ).toBe(false);
  });

  it("parses and unwraps a canonical wait result from the native service", async () => {
    const browser = {
      experimental_browser: {
        listTabs: () => [],
        listOwners: () => [],
        async openTab() {
          return target;
        },
        async run() {
          return {
            kind: "text",
            target,
          };
        },
        async experimental_requestContribution() {
          return null;
        },
      },
    };
    const parsed = browserOperationSchema.parse({
      operation: "wait",
      target,
      criteria: { kind: "text", text: "Loaded" },
      timeoutMs: 500,
    });
    const result = await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: parsed,
    });
    expect(result).toEqual({
      kind: "text",
      target,
    });
  });

  it("rejects a malformed wait result across the plugin boundary", async () => {
    const browser = {
      experimental_browser: {
        listTabs: () => [],
        listOwners: () => [],
        async openTab() {
          return target;
        },
        async run() {
          return { value: { garbage: true } };
        },
        async experimental_requestContribution() {
          return null;
        },
      },
    };
    const parsed = browserOperationSchema.parse({
      operation: "wait",
      target,
      criteria: { kind: "text", text: "Loaded" },
      timeoutMs: 500,
    });
    await expect(
      executeBrowserOperation({
        browser,
        context: agentContext,
        operation: parsed,
      }),
    ).rejects.toThrow("invalid typed result");
  });

  it("rejects a wait result whose kind does not match the request", async () => {
    const browser = {
      experimental_browser: {
        listTabs: () => [],
        listOwners: () => [],
        async openTab() {
          return target;
        },
        async run() {
          return {
            kind: "navigation",
            target,
            url: "https://example.com/next",
            phase: "commit",
            sameDocument: false,
          };
        },
        async experimental_requestContribution() {
          return null;
        },
      },
    };
    const parsed = browserOperationSchema.parse({
      operation: "wait",
      target,
      criteria: { kind: "popup" },
      timeoutMs: 500,
    });
    await expect(
      executeBrowserOperation({
        browser,
        context: agentContext,
        operation: parsed,
      }),
    ).rejects.toThrow("kind does not match the request");
  });
});
