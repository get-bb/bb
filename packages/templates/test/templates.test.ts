import { describe, expect, it } from "vitest";
import {
  getTemplateMetadata,
  listTemplates,
  renderTemplate,
  type TemplateId,
  type TemplateVariables,
} from "../src/index.js";

describe("@bb/templates", () => {
  it("lists template metadata", () => {
    const templates = listTemplates();
    expect(
      templates.some(
        (template) => template.id === "threadOperationCommitFailureFollowUp",
      ),
    ).toBe(true);
    expect(templates.some((template) => template.kind === "instruction")).toBe(
      true,
    );
  });

  it("returns metadata for an individual template", () => {
    const metadata = getTemplateMetadata("generateCommitMessage");
    expect(metadata.title).toBe("Commit Message Generator");
    expect(metadata.variables.diffDescription).toContain("diff snapshot");
  });

  it("renders a template with variables", () => {
    const rendered = renderTemplate("threadOperationCommitFailureFollowUp", {
      errorMessage: "hooks/pre-commit exited with status 1",
    });

    expect(rendered).toContain("Commit in this thread workspace failed.");
    expect(rendered).toContain("hooks/pre-commit exited with status 1");
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

  it("renders squash merge commit failure follow-up from structured variables", () => {
    const rendered = renderTemplate(
      "threadOperationSquashMergeCommitFailureFollowUp",
      {
        prepCommitMergeBaseBranch: "main",
        errorMessage: "nothing to commit",
      },
    );

    expect(rendered).toContain("could not create the prep commit");
    expect(rendered).toContain("main");
    expect(rendered).toContain("nothing to commit");
  });


  it("renders workflow run system messages in block form with the [bb system] prefix", () => {
    // The bodies are pinned exactly: the integration suites' wording markers
    // ("was paused", "completed. Fetch the result", "was cancelled") and the
    // manager-instructions claim that these arrive `[bb system]`-prefixed
    // both ride this rendering.
    expect(
      renderTemplate("systemMessageWorkflowRunPaused", {
        runId: "wfr_test",
        workflowName: "deep-research",
        reason: "host daemon unavailable",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "Workflow run wfr_test (deep-research) was paused: host daemon unavailable. The completed prefix is preserved — resume it from the run page or with `bb workflow resume wfr_test`.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageWorkflowRunCompleted", {
        runId: "wfr_test",
        workflowName: "deep-research",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "Workflow run wfr_test (deep-research) completed. Fetch the result with `bb workflow show wfr_test`.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageWorkflowRunFailed", {
        runId: "wfr_test",
        workflowName: "deep-research",
        failureSuffix: ": script_invalid",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "Workflow run wfr_test (deep-research) failed: script_invalid.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageWorkflowRunCancelled", {
        runId: "wfr_test",
        workflowName: "deep-research",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "Workflow run wfr_test (deep-research) was cancelled.",
      ].join("\n"),
    );
  });


  it("renders bbGuideApp", () => {
    const templates = listTemplates();
    expect(templates.some((template) => template.id === "bbGuideApp")).toBe(
      true,
    );

    const rendered = renderTemplate("bbGuideApp", {});

    expect(rendered).toContain("Apps");
    expect(rendered).toContain("<dataDir>/apps/<applicationId>/");
    expect(rendered).toContain("window.bb.data");
    expect(rendered).toContain("bb app current --json");
    expect(rendered).toContain("Vite + React + TypeScript Todo app");
    expect(rendered).toContain("pnpm build");
    expect(rendered).toContain("skills/add-todos/SKILL.md");
    expect(rendered).toContain(
      '<script src="https://cdn.tailwindcss.com"></script>',
    );
    expect(rendered).toContain(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap",
    );
    expect(rendered).toContain("--background: oklch(1 0 0);");
    expect(rendered).toContain(
      "@media (prefers-color-scheme: dark) {\n  :root {",
    );
    expect(rendered).toContain("--background: oklch(0.195 0 0);");
  });

  it("renders bbGuideSchedules", () => {
    const templates = listTemplates();
    expect(
      templates.some((template) => template.id === "bbGuideSchedules"),
    ).toBe(true);

    const rendered = renderTemplate("bbGuideSchedules", {});

    expect(rendered).toContain("Thread schedules");
    expect(rendered).toContain("bb thread schedule create");
    expect(rendered).toContain("--timezone America/Los_Angeles");
    expect(rendered).toContain("Schedule names are unique per thread.");
    expect(rendered).toContain("The cron month field must stay `*`.");
  });

  it("renders standardAgentAppendInstructions without user-question guidance", () => {
    const rendered = renderTemplate("standardAgentAppendInstructions", {});

    expect(rendered).toContain("You are working inside bb");
    expect(rendered).toContain("agentic IDE");
    expect(rendered).not.toContain(
      "Ask the user a blocking question only when",
    );
  });

  it("renders due thread schedule messages with schedule system chrome", () => {
    const rendered = renderTemplate("systemMessageThreadScheduleDue", {
      prompt: "Run the daily recap.",
      scheduleId: "tsched_daily",
    });

    expect(rendered).toBe(
      ["[bb schedule due:tsched_daily]", "", "Run the daily recap."].join(
        "\n",
      ),
    );
  });

  it("renders all templates without error", () => {
    const templates = listTemplates();

    // Build placeholder variables for each template
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
