// @vitest-environment jsdom

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import {
  aggregateThreats,
  categoryFromVocabulary,
  emptyStrideCounts,
  methodologyVocabulary,
  type StrideSegment,
  type ThreatSummary,
} from "./aggregate.js";
import { AttackPathOverlay } from "./AttackPathOverlay.js";
import {
  readThreatSnapshot,
  registerThreatOverlayBackend,
  threatOverlayRpcContract,
} from "./backend.js";
import {
  parseAttackPathSteps,
  resolveAttackPath,
} from "./path.js";
import {
  EMPTY_THREAT_SELECTION,
  reduceThreatSelection,
  threatFocusSubPath,
  threatSlugFromPathname,
} from "./selection.js";
import { StrideMicroBar } from "./StrideMicroBar.js";
import { ThreatTable } from "./ThreatTable.js";

const PROJECT_ID = "project-wp33";
const VERSION_ID = "@project";
const GENERATION_ID = "generation-wp33";
const PULLED_AT = "2026-08-12T16:00:00.000Z";
const LABELS: Record<StrideSegment, string> = {
  spoofing: "Spoofing",
  tampering: "Tampering",
  repudiation: "Repudiation",
  information_disclosure: "Information disclosure",
  denial_of_service: "Denial of service",
  elevation_of_privilege: "Elevation of privilege",
};
const observedThreatElements = new WeakSet<Element>();

class ThreatResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    if (observedThreatElements.has(target)) return;
    observedThreatElements.add(target);
    queueMicrotask(() => {
      const size = { blockSize: 174, inlineSize: 720 };
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 720, 174),
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
          },
        ],
        this,
      );
    });
  }

  unobserve(): void {}
  disconnect(): void {}
}

function threat(
  slug: string,
  category: ThreatSummary["category"],
  targetSlugs: string[],
): ThreatSummary {
  return {
    slug,
    title: `Threat ${slug}`,
    rawCategory: category,
    category,
    severity: "high",
    targetSlugs,
    attackPathCount: 0,
  };
}

function seedThreatOverlay(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  pathCount = 0,
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(
    PROJECT_ID,
    VERSION_ID,
    GENERATION_ID,
    '["threat","attack_path","methodology_profile"]',
    PULLED_AT,
    PULLED_AT,
    PULLED_AT,
  );
  const insertSync = db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull, error)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  );
  insertSync.run(
    PROJECT_ID,
    VERSION_ID,
    "threat",
    GENERATION_ID,
    33,
    PULLED_AT,
  );
  insertSync.run(
    PROJECT_ID,
    VERSION_ID,
    "attack_path",
    GENERATION_ID,
    33,
    PULLED_AT,
  );
  db.prepare(
    `INSERT INTO methodology_profiles
       (project_id, project_version_id, generation_id, profile_id, scope, name,
        asset_properties, impact_dimensions, risk_scale, assurance_levels,
        ownership_labels, stride_map, raw, pulled_at)
     VALUES (?, ?, ?, ?, 'project', ?, '[]', '[]', '[]', '[]', '[]', ?, '{}', ?)`,
  ).run(
    PROJECT_ID,
    VERSION_ID,
    GENERATION_ID,
    "methodology-wp33",
    "WP-33 methodology",
    JSON.stringify({
      spoofing: ["identity-spoof"],
      tampering: ["tampering"],
      repudiation: ["repudiation"],
      information_disclosure: ["information-disclosure"],
      denial_of_service: ["denial-of-service"],
      elevation_of_privilege: ["elevation-of-privilege"],
    }),
    PULLED_AT,
  );
  const insertThreat = db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        payload, content_hash, pulled_at)
     VALUES (?, ?, 'threat', ?, ?, ?, ?, ?)`,
  );
  insertThreat.run(
    PROJECT_ID,
    VERSION_ID,
    GENERATION_ID,
    "THREAT-spoof",
    JSON.stringify({
      title: "Spoof device identity",
      category: "identity-spoof",
      severity: "critical",
      affected_components: ["component-device", "component-api"],
      dataflow_slugs: ["flow-auth"],
    }),
    "hash-spoof",
    PULLED_AT,
  );
  insertThreat.run(
    PROJECT_ID,
    VERSION_ID,
    GENERATION_ID,
    "THREAT-custom",
    JSON.stringify({
      title: "Methodology extension",
      category: "custom-methodology-category",
      affected_components: ["component-device"],
    }),
    "hash-custom",
    PULLED_AT,
  );

  const insertPath = db.prepare(
    `INSERT INTO attack_paths
       (project_id, project_version_id, generation_id, path_id, route_signature,
        name, threat_key, steps, total_steps, exploitability, raw, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  );
  const insertPaths = db.transaction(() => {
    for (let index = 0; index < pathCount; index += 1) {
      const id = String(index).padStart(5, "0");
      insertPath.run(
        PROJECT_ID,
        VERSION_ID,
        GENERATION_ID,
        `path-${id}`,
        `route-${id}`,
        `Route ${id}`,
        "THREAT-spoof",
        JSON.stringify([
          { order: 1, nodeSlug: "component-device", label: "Device" },
        ]),
        1,
        JSON.stringify({ score: 0.73 }),
        PULLED_AT,
      );
    }
    insertPath.run(
      PROJECT_ID,
      VERSION_ID,
      GENERATION_ID,
      "path-malformed",
      "route-malformed",
      "Malformed route",
      "THREAT-custom",
      "{malformed",
      null,
      "0.12",
      PULLED_AT,
    );
  });
  insertPaths();
}

beforeAll(() => {
  installTestPluginRuntime();
  vi.stubGlobal("ResizeObserver", ThreatResizeObserver);
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    window.clearTimeout(handle);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 720, 174),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("WP-33 STRIDE aggregation", () => {
  it("aggregates every STRIDE category once per target and keeps unknown vocabulary under Other", () => {
    const vocabulary = methodologyVocabulary({
      spoofing: ["S", "identity-spoof"],
      tampering: ["T"],
      repudiation: ["R"],
      information_disclosure: ["I"],
      denial_of_service: ["D"],
      elevation_of_privilege: ["E"],
    });
    const categories = [
      "S",
      "T",
      "R",
      "I",
      "D",
      "E",
      "methodology-extension",
    ].map((value) => categoryFromVocabulary(value, vocabulary));
    const aggregates = aggregateThreats(
      categories.map((category, index) =>
        threat(`THREAT-${index}`, category, ["component-device"]),
      ),
    );

    expect(aggregates).toEqual([
      {
        targetSlug: "component-device",
        counts: {
          spoofing: 1,
          tampering: 1,
          repudiation: 1,
          information_disclosure: 1,
          denial_of_service: 1,
          elevation_of_privilege: 1,
          other: 1,
        },
        total: 7,
      },
    ]);
  });

  it("renders six textual segments, an explicit Other count, and stays quiet at zero", () => {
    const counts = emptyStrideCounts();
    counts.spoofing = 2;
    counts.other = 1;
    const view = render(
      <StrideMicroBar
        aggregate={{ targetSlug: "component-device", counts, total: 3 }}
        labels={LABELS}
      />,
    );
    for (const category of Object.values(LABELS)) {
      expect(view.getByLabelText(`${category}: ${category === "Spoofing" ? 2 : 0}`)).toBeTruthy();
    }
    expect(view.getByLabelText("Other methodology categories: 1")).toBeTruthy();

    view.rerender(
      <StrideMicroBar
        aggregate={{
          targetSlug: "component-quiet",
          counts: emptyStrideCounts(),
          total: 0,
        }}
        labels={LABELS}
      />,
    );
    expect(view.container.childElementCount).toBe(0);
  });
});

describe("WP-33 bidirectional selection and deep links", () => {
  it("filters rows from graph selection and highlights every target from one threat action", async () => {
    const threats = [
      threat("THREAT-device", "spoofing", ["component-device", "flow-auth"]),
      threat("THREAT-api", "tampering", ["component-api"]),
    ];
    const graphState = reduceThreatSelection(EMPTY_THREAT_SELECTION, {
      type: "graph",
      targetSlug: "component-device",
    });
    const onSelectThreat = vi.fn();
    const view = render(
      <ThreatTable
        filterTargetSlug={graphState.selection.targetSlug}
        labels={LABELS}
        onClearFilter={() => undefined}
        onSelectThreat={onSelectThreat}
        selectedThreatSlug={null}
        threats={threats}
      />,
    );
    expect(await view.findByText("Threat THREAT-device")).toBeTruthy();
    expect(view.queryByText("Threat THREAT-api")).toBeNull();
    fireEvent.click(view.getByText("Threat THREAT-device"));
    expect(onSelectThreat).toHaveBeenCalledWith(threats[0]);

    const threatState = reduceThreatSelection(graphState, {
      type: "threat",
      threat: threats[0]!,
    });
    expect(threatState).toEqual({
      selection: {
        threatSlug: "THREAT-device",
        targetSlug: null,
        routeSignature: null,
      },
      highlightedTargetSlugs: ["component-device", "flow-auth"],
    });
  });

  it("round-trips direct threat routes and preserves a still-valid path during reconciliation", () => {
    const slug = "THREAT/device 47";
    const path = threatFocusSubPath(slug);
    expect(path).toBe("tara/threats/THREAT%2Fdevice%2047");
    expect(threatSlugFromPathname(`/plugins/finite-state/${path}`)).toBe(slug);

    const selectedThreat = threat("THREAT-device", "spoofing", ["component-device"]);
    const selected = reduceThreatSelection(
      reduceThreatSelection(EMPTY_THREAT_SELECTION, {
        type: "threat",
        threat: selectedThreat,
      }),
      {
        type: "path",
        routeSignature: "route-selected",
        highlightedSlugs: ["component-device", "flow-auth"],
      },
    );
    expect(
      reduceThreatSelection(selected, {
        type: "reconcile",
        threats: [selectedThreat],
        routeSignatures: new Set(["route-selected"]),
      }),
    ).toEqual(selected);
  });
});

describe("WP-33 selected attack path", () => {
  it("renders only the selected ordered traversal, including gaps and parallel-flow ambiguity", () => {
    const parsed = parseAttackPathSteps(
      JSON.stringify([
        { order: 3, nodeSlug: "missing-node", label: "Unmapped service" },
        {
          order: 2,
          sourceSlug: "component-device",
          targetSlug: "component-api",
          label: "Cross trust boundary",
        },
        { order: 1, nodeSlug: "component-device", label: "Compromise device" },
      ]),
    );
    expect(parsed.error).toBeNull();
    const selectedPath = resolveAttackPath(
      "route-selected",
      "THREAT-device",
      parsed.steps,
      { score: 0.73 },
      "unknown",
      new Set(["component-device", "component-api"]),
      [
        { slug: "flow-auth-a", sourceSlug: "component-device", targetSlug: "component-api" },
        { slug: "flow-auth-b", sourceSlug: "component-device", targetSlug: "component-api" },
      ],
    );
    const view = render(
      <AttackPathOverlay
        error={null}
        loading={false}
        next={null}
        onLoadMore={() => undefined}
        onSelectPath={() => undefined}
        paths={[
          { routeSignature: "route-selected", label: "Selected route", totalSteps: 3 },
          { routeSignature: "route-not-selected", label: "Unselected route", totalSteps: 8 },
        ]}
        selectedPath={selectedPath}
        selectedRouteSignature="route-selected"
        total={5_000}
      />,
    );

    const steps = view.container.querySelectorAll("[data-path-step]");
    expect(steps).toHaveLength(3);
    expect([...steps].map((step) => step.getAttribute("data-path-step"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(view.getByText(/Gap — no current node or dataflow/u)).toBeTruthy();
    expect(view.getByText(/highlighting all 2 parallel dataflows/u)).toBeTruthy();
    expect(selectedPath.highlightedSlugs).toEqual([
      "component-device",
      "flow-auth-a",
      "flow-auth-b",
    ]);
    expect(view.getByText("Derived exploitability")).toBeTruthy();
    expect(view.getByText("Display-only evidence")).toBeTruthy();
    expect(view.getByText("Local viability decision")).toBeTruthy();
    expect(view.getByText("No local decision")).toBeTruthy();
    expect(view.getByText("Never inferred from exploitability.")).toBeTruthy();
  });

  it("shows loading, no-path, and scoped-error states without drawing a traversal", () => {
    const view = render(
      <AttackPathOverlay
        error={null}
        loading={true}
        next={null}
        onLoadMore={() => undefined}
        onSelectPath={() => undefined}
        paths={[]}
        selectedPath={null}
        selectedRouteSignature={null}
        total={0}
      />,
    );
    expect(view.getByRole("status").textContent).toContain("Loading selected path");
    view.rerender(
      <AttackPathOverlay
        error={null}
        loading={false}
        next={null}
        onLoadMore={() => undefined}
        onSelectPath={() => undefined}
        paths={[]}
        selectedPath={null}
        selectedRouteSignature={null}
        total={0}
      />,
    );
    expect(view.getByText("No cached attack paths map to this threat.")).toBeTruthy();
    view.rerender(
      <AttackPathOverlay
        error="Cached attack-path steps are malformed JSON. Threats and architecture remain usable."
        loading={false}
        next={null}
        onLoadMore={() => undefined}
        onSelectPath={() => undefined}
        paths={[]}
        selectedPath={null}
        selectedRouteSignature={null}
        total={0}
      />,
    );
    expect(view.getByRole("alert").textContent).toContain("architecture remain usable");
    expect(view.container.querySelectorAll("[data-path-step]")).toHaveLength(0);
  });
});

describe("WP-33 bounded cache and DOM", () => {
  it("memoizes the revision aggregate, pages 5,000 paths, and scopes malformed path errors", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state-wp33" });
    const ctx = createPluginContext(bb);
    registerThreatOverlayBackend(bb, ctx);
    seedThreatOverlay(ctx.db(), 5_000);

    const cache = new Map();
    const first = readThreatSnapshot(
      ctx.db(),
      { projectId: PROJECT_ID, projectVersionId: null },
      cache,
    );
    const second = readThreatSnapshot(
      ctx.db(),
      { projectId: PROJECT_ID, projectVersionId: null },
      cache,
    );
    expect(second).toBe(first);
    expect(first.threats).toEqual([
      expect.objectContaining({
        slug: "THREAT-custom",
        category: "other",
        attackPathCount: 1,
      }),
      expect.objectContaining({
        slug: "THREAT-spoof",
        category: "spoofing",
        attackPathCount: 5_000,
      }),
    ]);
    expect(first.aggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetSlug: "component-device",
          total: 2,
          counts: expect.objectContaining({ spoofing: 1, other: 1 }),
        }),
      ]),
    );

    const page = threatOverlayRpcContract.threatOverlayPaths.output.parse(
      await harness.behavior.callRpc("threatOverlayPaths", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        threatSlug: "THREAT-spoof",
        pageSize: 50,
        continuation: null,
      }),
    );
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(5_000);
    expect(page.next).not.toBeNull();

    const malformed = threatOverlayRpcContract.threatOverlayPath.output.parse(
      await harness.behavior.callRpc("threatOverlayPath", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        routeSignature: "route-malformed",
      }),
    );
    expect(malformed.path).toBeNull();
    expect(malformed.error).toMatch(/malformed JSON.*remain usable/u);

    const stillUsable = threatOverlayRpcContract.threatOverlaySnapshot.output.parse(
      await harness.behavior.callRpc("threatOverlaySnapshot", {
        projectId: PROJECT_ID,
        projectVersionId: null,
      }),
    );
    expect(stillUsable.threats).toHaveLength(2);
    await harness.lifecycle.dispose();
  });

  it("virtualizes 2,000 threat rows and exposes no-threat and unconfigured states", async () => {
    const threats = Array.from({ length: 2_000 }, (_, index) =>
      threat(`THREAT-${String(index).padStart(4, "0")}`, "spoofing", ["component-device"]),
    );
    const view = render(
      <ThreatTable
        filterTargetSlug={null}
        labels={LABELS}
        onClearFilter={() => undefined}
        onSelectThreat={() => undefined}
        selectedThreatSlug={null}
        threats={threats}
      />,
    );
    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-threat-row]").length).toBeGreaterThan(0);
    });
    expect(view.container.querySelectorAll("[data-threat-row]").length).toBeLessThan(30);
    expect(view.getByRole("grid").getAttribute("aria-rowcount")).toBe("2000");

    view.rerender(
      <ThreatTable
        filterTargetSlug={null}
        labels={LABELS}
        onClearFilter={() => undefined}
        onSelectThreat={() => undefined}
        selectedThreatSlug={null}
        threats={[]}
      />,
    );
    expect(view.getByText("No open threats are present in the accepted model.")).toBeTruthy();

    const { ProductSecurityThreatOverlay } = await import("./index.js");
    const slot = renderSlot(
      { component: () => <ProductSecurityThreatOverlay /> },
      { subPath: "tara" },
      { context: { projectId: null, threadId: null } },
    );
    expect(slot.getByText("Threat overlay needs a project")).toBeTruthy();
    slot.unmount();
  });
});
