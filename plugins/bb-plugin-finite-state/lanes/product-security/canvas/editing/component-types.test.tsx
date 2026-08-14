// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent } from "@testing-library/react";
import { renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityForm } from "./forms.js";
import {
  ASSURANCE_STUDIO_ASSET_TYPES,
  ASSURANCE_STUDIO_COMPONENT_TYPES,
  assetTypeSchema,
  componentTypeSchema,
} from "./schema.js";

afterEach(cleanup);

describe("Assurance Studio component types", () => {
  it("extends the vendored ComponentType enum only with the connected tenant value", async () => {
    const reference = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "docs/Implementation/api-reference/assurance-studio-openapi-2026-05-12.json",
        ),
        "utf8",
      ),
    ) as {
      components: { schemas: { ComponentType: { enum: string[] } } };
    };
    expect(componentTypeSchema.options).toEqual([
      ...reference.components.schemas.ComponentType.enum,
      "external_service",
    ]);
  });

  it("authors each known component type from the component form", () => {
    for (const componentType of ASSURANCE_STUDIO_COMPONENT_TYPES) {
      const onSubmit = vi.fn();
      const view = renderSlot(
        { component: EntityForm },
        {
          mode: "create" as const,
          entityKind: "component" as const,
          initial: null,
          references: { components: [], zones: [], assets: [], dataflows: [] },
          saving: false,
          error: null,
          onCancel: vi.fn(),
          onSubmit,
        },
      );
      fireEvent.change(view.getByLabelText(/Stable slug/u), {
        target: { value: `component-${componentType.replaceAll("_", "-")}` },
      });
      fireEvent.change(view.getByLabelText("Name"), {
        target: { value: `${componentType} component` },
      });
      fireEvent.change(view.getByLabelText("Component type"), {
        target: { value: componentType },
      });
      fireEvent.click(view.getByRole("button", { name: "Save local YAML" }));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ component_type: componentType }),
      );
      view.lifecycle.unmount();
    }
  });

  it("authors the connected asset_type vocabulary exposed by the form", () => {
    expect(assetTypeSchema.options).toEqual(ASSURANCE_STUDIO_ASSET_TYPES);
    const onSubmit = vi.fn();
    const view = renderSlot(
      { component: EntityForm },
      {
        mode: "create" as const,
        entityKind: "asset" as const,
        initial: null,
        references: { components: [], zones: [], assets: [], dataflows: [] },
        saving: false,
        error: null,
        onCancel: vi.fn(),
        onSubmit,
      },
    );
    fireEvent.change(view.getByLabelText(/Stable slug/u), {
      target: { value: "connected-asset" },
    });
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Connected asset" },
    });
    const select = view.getByLabelText("Asset type");
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Asset type control is not a select");
    }
    expect([...select.options].map((option) => option.value)).toEqual([
      ...ASSURANCE_STUDIO_ASSET_TYPES,
    ]);
    for (const assetType of ASSURANCE_STUDIO_ASSET_TYPES) {
      fireEvent.change(select, { target: { value: assetType } });
      fireEvent.click(view.getByRole("button", { name: "Save local YAML" }));
      expect(onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ asset_type: assetType }),
      );
    }
  });
});
