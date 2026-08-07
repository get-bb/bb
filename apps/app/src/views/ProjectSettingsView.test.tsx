// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectScriptHashTarget } from "./ProjectSettingsView";

function ProjectScriptHashTargetHarness() {
  useProjectScriptHashTarget(true);
  return (
    <>
      <textarea id="project-setup-script" aria-label="Setup" />
      <textarea id="project-run-script" aria-label="Run" />
    </>
  );
}

function ProjectScriptHashChangeHarness() {
  useProjectScriptHashTarget(true);
  return (
    <>
      <Link to="#project-run-script">Reveal Run</Link>
      <textarea id="project-run-script" aria-label="Run" />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("project script hash targets", () => {
  it.each([
    {
      fieldId: "project-setup-script",
      hash: "#project-setup-script",
    },
    {
      fieldId: "project-run-script",
      hash: "#project-run-script",
    },
  ])("reveals and focuses $hash", ({ fieldId, hash }) => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    render(
      <MemoryRouter initialEntries={[`/projects/project-one/settings${hash}`]}>
        <ProjectScriptHashTargetHarness />
      </MemoryRouter>,
    );

    const field = document.getElementById(fieldId);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(field);
  });

  it("ignores unrelated hashes", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    render(
      <MemoryRouter
        initialEntries={["/projects/project-one/settings#project-sources"]}
      >
        <ProjectScriptHashTargetHarness />
      </MemoryRouter>,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("responds when the hash changes after mount", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    render(
      <MemoryRouter initialEntries={["/projects/project-one/settings"]}>
        <ProjectScriptHashChangeHarness />
      </MemoryRouter>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "Reveal Run" }));

    const field = document.getElementById("project-run-script");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(field);
  });
});
