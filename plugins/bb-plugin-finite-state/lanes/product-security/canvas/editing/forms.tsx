import { useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  architectureEntityPayload,
  componentTypeSchema,
  criticalitySchema,
  parseArchitectureEntity,
  strideCategorySchema,
  threatSourceSchema,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
} from "./schema.js";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LABEL_CLASS = "space-y-1.5 text-sm font-medium";

export interface CanvasReferenceOptions {
  components: readonly string[];
  zones: readonly string[];
  assets: readonly string[];
  dataflows: readonly string[];
}

export interface EntityFormProps {
  mode: "create" | "edit";
  entityKind: CanvasEntityKind;
  initial: ArchitectureYamlEntity | null;
  references: CanvasReferenceOptions;
  saving: boolean;
  error: string | null;
  onCancel(): void;
  onSubmit(entity: ArchitectureYamlEntity): void;
}

function stringValue(
  fields: Record<string, unknown>,
  field: string,
  fallback = "",
): string {
  const value = fields[field];
  return typeof value === "string" ? value : fallback;
}

function booleanValue(fields: Record<string, unknown>, field: string): boolean {
  return fields[field] === true;
}

function listValue(fields: Record<string, unknown>, field: string): string {
  const value = fields[field];
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join(", ")
    : "";
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function defaultPayload(kind: CanvasEntityKind): Record<string, unknown> {
  switch (kind) {
    case "component":
      return {
        slug: "",
        name: "",
        component_type: "software",
        criticality: "medium",
        interfaces: [],
        technologies: [],
        is_entry_point: false,
        stores_data: false,
      };
    case "zone":
      return { slug: "", name: "", trust_level: "semi_trusted" };
    case "asset":
      return {
        slug: "",
        name: "",
        asset_type: "data",
        criticality: "medium",
      };
    case "dataflow":
      return {
        slug: "",
        name: "",
        from: "",
        to: "",
        data_types: [],
        encrypted: false,
        authenticated: false,
        bidirectional: false,
      };
    case "threat":
      return {
        slug: "",
        name: "",
        category: "spoofing",
        threat_source: "manual",
        severity: "medium",
        affected_components: [],
        affected_assets: [],
        dataflows: [],
        mitigations: [],
        assumptions: [],
      };
  }
}

function ReferenceSelect({
  id,
  label,
  value,
  values,
  required = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: readonly string[];
  required?: boolean;
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <label className={LABEL_CLASS} htmlFor={id}>
      {label}
      <select
        className={INPUT_CLASS}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      >
        <option value="">
          {required ? "Select a stable slug" : "No reference"}
        </option>
        {values.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EntityForm({
  mode,
  entityKind,
  initial,
  references,
  saving,
  error,
  onCancel,
  onSubmit,
}: EntityFormProps): React.JSX.Element {
  const initialPayload = useMemo(
    () =>
      initial ? architectureEntityPayload(initial) : defaultPayload(entityKind),
    [entityKind, initial],
  );
  const [slug, setSlug] = useState(() => stringValue(initialPayload, "slug"));
  const [name, setName] = useState(() => stringValue(initialPayload, "name"));
  const [description, setDescription] = useState(() =>
    stringValue(initialPayload, "description"),
  );
  const [componentType, setComponentType] = useState(() =>
    stringValue(initialPayload, "component_type", "software"),
  );
  const [criticality, setCriticality] = useState(() =>
    stringValue(
      initialPayload,
      entityKind === "threat" ? "severity" : "criticality",
      "medium",
    ),
  );
  const [zone, setZone] = useState(() => stringValue(initialPayload, "zone"));
  const [trustLevel, setTrustLevel] = useState(() =>
    stringValue(initialPayload, "trust_level", "semi_trusted"),
  );
  const [assetType, setAssetType] = useState(() =>
    stringValue(initialPayload, "asset_type", "data"),
  );
  const [classification, setClassification] = useState(() =>
    stringValue(initialPayload, "data_classification"),
  );
  const [from, setFrom] = useState(() => stringValue(initialPayload, "from"));
  const [to, setTo] = useState(() => stringValue(initialPayload, "to"));
  const [protocol, setProtocol] = useState(() =>
    stringValue(initialPayload, "protocol"),
  );
  const [dataTypes, setDataTypes] = useState(() =>
    listValue(initialPayload, "data_types"),
  );
  const [technologies, setTechnologies] = useState(() =>
    listValue(initialPayload, "technologies"),
  );
  const [encrypted, setEncrypted] = useState(() =>
    booleanValue(initialPayload, "encrypted"),
  );
  const [authenticated, setAuthenticated] = useState(() =>
    booleanValue(initialPayload, "authenticated"),
  );
  const [bidirectional, setBidirectional] = useState(() =>
    booleanValue(initialPayload, "bidirectional"),
  );
  const [entryPoint, setEntryPoint] = useState(() =>
    booleanValue(initialPayload, "is_entry_point"),
  );
  const [dataStore, setDataStore] = useState(() =>
    booleanValue(initialPayload, "stores_data"),
  );
  const [category, setCategory] = useState(() =>
    stringValue(initialPayload, "category", "spoofing"),
  );
  const [threatSource, setThreatSource] = useState(() =>
    stringValue(initialPayload, "threat_source", "manual"),
  );
  const [affectedComponents, setAffectedComponents] = useState(() =>
    listValue(initialPayload, "affected_components"),
  );
  const [affectedAssets, setAffectedAssets] = useState(() =>
    listValue(initialPayload, "affected_assets"),
  );
  const [affectedDataflows, setAffectedDataflows] = useState(() =>
    listValue(initialPayload, "dataflows"),
  );
  const [mitigations, setMitigations] = useState(() =>
    listValue(initialPayload, "mitigations"),
  );
  const [assumptions, setAssumptions] = useState(() =>
    listValue(initialPayload, "assumptions"),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const common = {
      ...initialPayload,
      slug: slug.trim(),
      name: name.trim(),
      description: optional(description),
    };
    let payload: Record<string, unknown>;
    switch (entityKind) {
      case "component":
        payload = {
          ...common,
          component_type: componentType,
          criticality,
          zone: optional(zone),
          technologies: parseList(technologies),
          is_entry_point: entryPoint,
          stores_data: dataStore,
        };
        break;
      case "zone":
        payload = { ...common, trust_level: trustLevel, zone: optional(zone) };
        break;
      case "asset":
        payload = {
          ...common,
          asset_type: assetType,
          criticality,
          zone: optional(zone),
          data_classification: optional(classification),
        };
        break;
      case "dataflow":
        payload = {
          ...common,
          from,
          to,
          protocol: optional(protocol),
          data_types: parseList(dataTypes),
          encrypted,
          authenticated,
          bidirectional,
        };
        break;
      case "threat":
        payload = {
          ...common,
          category,
          threat_source: threatSource,
          severity: criticality,
          affected_components: parseList(affectedComponents),
          affected_assets: parseList(affectedAssets),
          dataflows: parseList(affectedDataflows),
          mitigations: parseList(mitigations),
          assumptions: parseList(assumptions),
        };
        break;
    }
    for (const [field, value] of Object.entries(payload)) {
      if (value === undefined) delete payload[field];
    }
    try {
      onSubmit(parseArchitectureEntity(entityKind, payload));
      setLocalError(null);
    } catch (parseError) {
      setLocalError(
        parseError instanceof Error
          ? parseError.message
          : "The entity fields are invalid.",
      );
    }
  }

  const formError = localError ?? error;
  return (
    <div
      aria-label={`${mode === "create" ? "Create" : "Edit"} ${entityKind}`}
      aria-modal="true"
      className="fixed inset-0 z-[75] grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <form
        className="flex max-h-[min(780px,calc(100vh-2rem))] w-full max-w-2xl flex-col rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        onSubmit={submit}
      >
        <header className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Local architecture intent
          </p>
          <h2 className="mt-1 text-base font-semibold capitalize">
            {mode} {entityKind}
          </h2>
        </header>
        <div className="grid gap-4 overflow-auto p-5 sm:grid-cols-2">
          <label className={LABEL_CLASS} htmlFor="canvas-entity-slug">
            Stable slug
            <input
              autoFocus={mode === "create"}
              className={INPUT_CLASS}
              disabled={mode === "edit"}
              id="canvas-entity-slug"
              onChange={(event) => setSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              value={slug}
            />
            <span className="block text-xs font-normal text-muted-foreground">
              Permanent, lowercase, and never reused.
            </span>
          </label>
          <label className={LABEL_CLASS} htmlFor="canvas-entity-name">
            Name
            <input
              className={INPUT_CLASS}
              id="canvas-entity-name"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label
            className={`${LABEL_CLASS} sm:col-span-2`}
            htmlFor="canvas-entity-description"
          >
            Description
            <textarea
              className={TEXTAREA_CLASS}
              id="canvas-entity-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>

          {entityKind === "component" ? (
            <>
              <label className={LABEL_CLASS} htmlFor="canvas-component-type">
                Component type
                <select
                  className={INPUT_CLASS}
                  id="canvas-component-type"
                  onChange={(event) => setComponentType(event.target.value)}
                  value={componentType}
                >
                  {componentTypeSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <ReferenceSelect
                id="canvas-component-zone"
                label="Zone"
                onChange={setZone}
                value={zone}
                values={references.zones}
              />
              <label
                className={`${LABEL_CLASS} sm:col-span-2`}
                htmlFor="canvas-component-technologies"
              >
                Technologies (comma separated)
                <input
                  className={INPUT_CLASS}
                  id="canvas-component-technologies"
                  onChange={(event) => setTechnologies(event.target.value)}
                  value={technologies}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={entryPoint}
                  onChange={(event) => setEntryPoint(event.target.checked)}
                  type="checkbox"
                />{" "}
                Entry point
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={dataStore}
                  onChange={(event) => setDataStore(event.target.checked)}
                  type="checkbox"
                />{" "}
                Data store
              </label>
            </>
          ) : null}

          {entityKind === "zone" ? (
            <>
              <label className={LABEL_CLASS} htmlFor="canvas-zone-trust">
                Trust level
                <select
                  className={INPUT_CLASS}
                  id="canvas-zone-trust"
                  onChange={(event) => setTrustLevel(event.target.value)}
                  value={trustLevel}
                >
                  {(
                    [
                      "trusted",
                      "highly_trusted",
                      "semi_trusted",
                      "untrusted",
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <ReferenceSelect
                id="canvas-zone-parent"
                label="Parent zone"
                onChange={setZone}
                value={zone}
                values={references.zones.filter(
                  (candidate) => candidate !== slug,
                )}
              />
            </>
          ) : null}

          {entityKind === "asset" ? (
            <>
              <label className={LABEL_CLASS} htmlFor="canvas-asset-type">
                Asset type
                <select
                  className={INPUT_CLASS}
                  id="canvas-asset-type"
                  onChange={(event) => setAssetType(event.target.value)}
                  value={assetType}
                >
                  {(
                    [
                      "data",
                      "credential",
                      "cryptographic_key",
                      "configuration",
                      "service",
                      "device",
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <ReferenceSelect
                id="canvas-asset-zone"
                label="Zone"
                onChange={setZone}
                value={zone}
                values={references.zones}
              />
              <label
                className={LABEL_CLASS}
                htmlFor="canvas-asset-classification"
              >
                Data classification
                <select
                  className={INPUT_CLASS}
                  id="canvas-asset-classification"
                  onChange={(event) => setClassification(event.target.value)}
                  value={classification}
                >
                  <option value="">Not classified</option>
                  {(
                    [
                      "public",
                      "internal",
                      "confidential",
                      "restricted",
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {entityKind === "component" ||
          entityKind === "asset" ||
          entityKind === "threat" ? (
            <label className={LABEL_CLASS} htmlFor="canvas-criticality">
              {entityKind === "threat" ? "Severity" : "Criticality"}
              <select
                className={INPUT_CLASS}
                id="canvas-criticality"
                onChange={(event) => setCriticality(event.target.value)}
                value={criticality}
              >
                {criticalitySchema.options.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {entityKind === "dataflow" ? (
            <>
              <ReferenceSelect
                id="canvas-flow-from"
                label="From component"
                onChange={setFrom}
                required
                value={from}
                values={references.components}
              />
              <ReferenceSelect
                id="canvas-flow-to"
                label="To component"
                onChange={setTo}
                required
                value={to}
                values={references.components}
              />
              <label className={LABEL_CLASS} htmlFor="canvas-flow-protocol">
                Protocol
                <input
                  className={INPUT_CLASS}
                  id="canvas-flow-protocol"
                  onChange={(event) => setProtocol(event.target.value)}
                  value={protocol}
                />
              </label>
              <label className={LABEL_CLASS} htmlFor="canvas-flow-data">
                Data types (comma separated)
                <input
                  className={INPUT_CLASS}
                  id="canvas-flow-data"
                  onChange={(event) => setDataTypes(event.target.value)}
                  value={dataTypes}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={encrypted}
                  onChange={(event) => setEncrypted(event.target.checked)}
                  type="checkbox"
                />{" "}
                Encrypted
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={authenticated}
                  onChange={(event) => setAuthenticated(event.target.checked)}
                  type="checkbox"
                />{" "}
                Authenticated
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={bidirectional}
                  onChange={(event) => setBidirectional(event.target.checked)}
                  type="checkbox"
                />{" "}
                Bidirectional
              </label>
            </>
          ) : null}

          {entityKind === "threat" ? (
            <>
              <label className={LABEL_CLASS} htmlFor="canvas-threat-category">
                STRIDE category
                <select
                  className={INPUT_CLASS}
                  id="canvas-threat-category"
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  {strideCategorySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS} htmlFor="canvas-threat-source">
                Methodology source
                <select
                  className={INPUT_CLASS}
                  id="canvas-threat-source"
                  onChange={(event) => setThreatSource(event.target.value)}
                  value={threatSource}
                >
                  {threatSourceSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className={`${LABEL_CLASS} sm:col-span-2`}
                htmlFor="canvas-threat-components"
              >
                Affected component slugs
                <input
                  className={INPUT_CLASS}
                  id="canvas-threat-components"
                  onChange={(event) =>
                    setAffectedComponents(event.target.value)
                  }
                  value={affectedComponents}
                />
              </label>
              <label className={LABEL_CLASS} htmlFor="canvas-threat-assets">
                Affected asset slugs
                <input
                  className={INPUT_CLASS}
                  id="canvas-threat-assets"
                  onChange={(event) => setAffectedAssets(event.target.value)}
                  value={affectedAssets}
                />
              </label>
              <label className={LABEL_CLASS} htmlFor="canvas-threat-flows">
                Affected dataflow slugs
                <input
                  className={INPUT_CLASS}
                  id="canvas-threat-flows"
                  onChange={(event) => setAffectedDataflows(event.target.value)}
                  value={affectedDataflows}
                />
              </label>
              <label
                className={LABEL_CLASS}
                htmlFor="canvas-threat-mitigations"
              >
                Mitigation slugs
                <input
                  className={INPUT_CLASS}
                  id="canvas-threat-mitigations"
                  onChange={(event) => setMitigations(event.target.value)}
                  value={mitigations}
                />
              </label>
              <label
                className={LABEL_CLASS}
                htmlFor="canvas-threat-assumptions"
              >
                Assumptions
                <input
                  className={INPUT_CLASS}
                  id="canvas-threat-assumptions"
                  onChange={(event) => setAssumptions(event.target.value)}
                  value={assumptions}
                />
              </label>
            </>
          ) : null}
        </div>
        {formError ? (
          <p
            className="mx-5 mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {formError}
          </p>
        ) : null}
        <footer className="flex items-center justify-between gap-3 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            Writes tracked YAML. Review and push remain separate human actions.
          </p>
          <div className="flex gap-2">
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={saving} type="submit">
              <Icon aria-hidden="true" name="CircleCheck" />
              {saving ? "Writing local YAML…" : "Save local YAML"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
