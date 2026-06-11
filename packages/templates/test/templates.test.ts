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
