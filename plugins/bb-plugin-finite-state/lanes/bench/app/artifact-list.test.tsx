// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ArtifactList } from "./artifact-list.js";

afterEach(() => cleanup());

describe("ArtifactList", () => {
  it("uses safe logical names and verified hashes, never upstream paths", () => {
    const view = render(<ArtifactList projectId="p1" runId="run-1" artifacts={[{ name: "report.json", kind: "evidence", sha256: "a".repeat(64), bytes: 42, downloadAvailable: true }, { name: "../../etc/passwd", kind: "malicious", sha256: "b".repeat(64), bytes: 1, downloadAvailable: true }]} />);
    const link = view.getByRole("link", { name: /Download/u });
    expect(link.getAttribute("href")).toBe("/api/v1/plugins/finite-state/http/bench/runs/artifact?projectId=p1&runId=run-1&artifactName=report.json");
    expect(view.container.querySelector('a[href*="etc"]')).toBeNull();
    expect(view.getByText(/unsafe or expired logical name/u)).toBeTruthy();
    expect(view.getByText(`sha256 ${"a".repeat(64)}`)).toBeTruthy();
  });

  it("offers recovery instead of a download when hash verification is absent", () => {
    const view = render(<ArtifactList projectId="p1" runId="run-1" artifacts={[{ name: "evidence.bin", kind: "binary", sha256: null, bytes: null }]} />);
    expect(view.getByText("Recovery needed")).toBeTruthy();
    expect(view.queryByRole("link")).toBeNull();
  });

  it("offers recovery when the logical-locator byte adapter is unavailable", () => {
    const view = render(<ArtifactList projectId="p1" runId="run-1" artifacts={[{ name: "evidence.bin", kind: "binary", sha256: "a".repeat(64), bytes: 42, downloadAvailable: false }]} />);
    expect(view.getByText("Recovery needed")).toBeTruthy();
    expect(view.queryByRole("link")).toBeNull();
  });
});
