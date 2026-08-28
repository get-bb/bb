import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  type TemplateId,
  type TemplateVariables,
} from "../src/index.js";
import { templateDefinitions } from "../src/generated/templates.generated.js";

describe("@bb/templates", () => {
  it("documents where threads should put files they create", () => {
    const guide = renderTemplate("bbGuideThreads", {});

    expect(guide).toContain(
      [
        "**Where to put files you create**",
        "",
        "If the user gives you an exact path, use it.",
        "",
        "Otherwise, use this thread’s workspace—the directory bb started you in—for files the user asked you to create or change.",
        "",
        "Put any other files or directories you create while doing the work under `$BB_THREAD_STORAGE`. Common examples are additional repository clones or Git worktrees, temporary test projects or fixtures, downloads, screenshots or recordings, logs, and generated reports.",
        "",
        "Do not create those other files beside the thread’s workspace or elsewhere in the user’s home directory for convenience. Do not move a tool’s own temporary files or caches solely to satisfy this rule.",
        "",
        "`$BB_THREAD_STORAGE` belongs to this thread. bb permanently deletes it 24 hours after the thread is archived unless the thread is unarchived. Put anything that needs to be kept in the thread’s workspace or in the exact path the user requested.",
      ].join("\n"),
    );
    expect(renderTemplate("standardAgentAppendInstructions", {})).not.toContain(
      "Where to put files you create",
    );
  });

  it("documents project creation machine routing", () => {
    const guide = renderTemplate("bbGuideProjects", {});

    expect(guide).toContain("bb project create --name");
    expect(guide).toContain("--machine <id-or-name>");
    expect(guide).toContain("--host <id-or-name>");
    expect(guide).toContain("local CLI machine fallback");
  });

  it("documents complete and partial automation execution updates", () => {
    const guide = renderTemplate("bbGuideAutomations", {});

    expect(guide).toContain("bb automation update <automationId>");
    expect(guide).toContain("Partial updates to an existing");
    expect(guide).toContain("--env-json");
    expect(guide).toContain("--reasoning <none|low|medium|high");
    expect(guide).toContain("--service-tier default|fast|none");
    expect(guide).toContain("--permission-mode <accept-edits|auto|full>");
    expect(guide).not.toContain("workspace-write|readonly");
  });

  it("renders agent thread messages without inline reply guidance", () => {
    const rendered = renderTemplate("agentThreadMessage", {
      senderThreadId: "thr_sender",
      messageText: "Please check the failing test.",
    });

    expect(rendered).toBe(
      [
        "[bb message from thread:thr_sender]",
        "",
        "Please check the failing test.",
      ].join("\n"),
    );
  });

  it("renders standardAgentAppendInstructions without user-question guidance", () => {
    const rendered = renderTemplate("standardAgentAppendInstructions", {});

    expect(rendered).toContain("You are working inside bb");
    expect(rendered).toContain("agentic IDE");
    expect(rendered).not.toContain(
      "Ask the user a blocking question only when",
    );
  });

  it("renders child thread needs-attention messages with blocker summaries", () => {
    const rendered = renderTemplate("systemMessageChildThreadNeedsAttention", {
      blockerSummary: [
        "Blocked on command approval:",
        "Command: git push",
      ].join("\n"),
      threadMention: "@thread:thr_child",
    });

    expect(rendered).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child needs help.",
        "Blocked on command approval:",
        "Command: git push",
        "",
        "Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.",
      ].join("\n"),
    );
  });

  it("renders child thread ownership messages", () => {
    expect(
      renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is now a child of this thread.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is no longer a child of this thread.",
      ].join("\n"),
    );
  });

  it("renders all templates without error", () => {
    const templates = templateDefinitions;

    const placeholderVariables: Record<string, Record<string, string>> = {};
    for (const template of templates) {
      const vars: Record<string, string> = {};
      for (const varName of Object.keys(template.variables)) {
        vars[varName] = `__placeholder_${varName}__`;
      }
      placeholderVariables[template.id] = vars;
    }

    for (const template of templates) {
      const vars = placeholderVariables[
        template.id
      ] as TemplateVariables[TemplateId];
      expect(() =>
        renderTemplate(template.id as TemplateId, vars),
      ).not.toThrow();
    }
  });
});
