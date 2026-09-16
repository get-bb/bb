import { useState, type ReactNode } from "react";
import type { MachineEnvironmentList } from "@bb/server-contract";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import {
  MachineEnvironmentAutomaticRow,
  MachineEnvironmentInheritedRow,
  MachineEnvironmentSettingsContent,
  MachineEnvironmentVariableRow,
} from "./MachineEnvironmentSettings";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "settings/Machine Environment",
};

const noop = () => {};
const noopSave = async () => {};

type Variable = MachineEnvironmentList["variables"][number];

function secret(name: string, note: string | null = null): Variable {
  return { name, value: null, secret: true, note };
}

const LOGGED_IN: MachineEnvironmentList["builtInGit"] = {
  status: "logged in",
  statusMessage: "gh is authenticated",
};
const SIGNED_OUT: MachineEnvironmentList["builtInGit"] = {
  status: "not logged in",
  statusMessage: "gh is signed out",
};
const GIT_OFF: MachineEnvironmentList["builtInGit"] = {
  status: "disabled",
  statusMessage: "Automatic token is off",
};
const LONG_NAME = "GOOGLE_APPLICATION_CREDENTIALS_JSON";
const LONG_NOTE =
  "Service account for the analytics export. Rotate it with the infra team before every release; production credentials must never be set here.";

const GLOBAL_VARIABLES = [
  secret("ANTHROPIC_API_KEY"),
  secret("DATABASE_URL", "Points at the staging replica, not production."),
  secret(LONG_NAME, LONG_NOTE),
  secret("SENTRY_DSN"),
];

function environment(
  builtInGit: MachineEnvironmentList["builtInGit"],
  variables: readonly Variable[] = [],
): MachineEnvironmentList {
  return { builtInGit, variables: [...variables] };
}

function Stage({
  environment,
  loadFailed = false,
  gitCredentialsEnabled = true,
  projectScope = false,
  inheritedVariables = [],
  scopeControl,
}: {
  environment: MachineEnvironmentList | null;
  loadFailed?: boolean;
  gitCredentialsEnabled?: boolean;
  projectScope?: boolean;
  inheritedVariables?: readonly Variable[];
  scopeControl?: ReactNode;
}) {
  return (
    <div className="w-full max-w-3xl">
      <MachineEnvironmentSettingsContent
        environment={environment}
        loadFailed={loadFailed}
        gitCredentialsEnabled={gitCredentialsEnabled}
        projectScope={projectScope}
        scopeControl={scopeControl}
        inheritedVariables={inheritedVariables}
        onSave={noopSave}
        onSetGitCredentials={noop}
      />
    </div>
  );
}

const SCOPES = {
  global: {
    label: "All projects",
    environment: environment(LOGGED_IN, GLOBAL_VARIABLES),
    inheritedVariables: [],
  },
  atlas: {
    label: "atlas",
    environment: environment(LOGGED_IN, [
      secret("DATABASE_URL", "Points at the atlas sandbox."),
    ]),
    inheritedVariables: GLOBAL_VARIABLES,
  },
  bb: {
    label: "bb",
    environment: environment(LOGGED_IN),
    inheritedVariables: GLOBAL_VARIABLES,
  },
} as const;

type ScopeId = keyof typeof SCOPES;

function GlobalSettingsStage() {
  const [scope, setScope] = useState<ScopeId>("global");
  const selected = SCOPES[scope];
  return (
    <Stage
      key={scope}
      environment={selected.environment}
      projectScope={scope !== "global"}
      inheritedVariables={selected.inheritedVariables}
      scopeControl={
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="text-sm text-subtle-foreground">
            Showing variables for
          </span>
          <OptionPicker
            modal={false}
            label="Scope"
            className="text-sm"
            value={scope}
            onChange={setScope}
            options={Object.entries(SCOPES).map(([value, entry]) => ({
              value: value as ScopeId,
              label: entry.label,
            }))}
          />
        </div>
      }
    />
  );
}

export function Scopes() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="Settings → Environment variables"
        hint="the header leads, then the scope control; switching projects must not reflow the header"
      >
        <GlobalSettingsStage />
      </StoryRow>
      <StoryRow
        label="Project settings"
        hint="the same editor for one project, reached from the project page, so it carries no picker"
      >
        <Stage
          environment={SCOPES.atlas.environment}
          projectScope
          inheritedVariables={GLOBAL_VARIABLES}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="first run"
        hint="nothing configured yet, so the automatic GH_TOKEN row is the whole section"
      >
        <Stage environment={environment(LOGGED_IN)} />
      </StoryRow>
      <StoryRow
        label="saved variables"
        hint="saved secrets never come back from the server; notes wrap under their row"
      >
        <Stage environment={environment(LOGGED_IN, GLOBAL_VARIABLES)} />
      </StoryRow>
      <StoryRow
        label="project · nothing set"
        hint="how most projects start: the inherited token with an override action, and nothing else"
      >
        <Stage environment={environment(LOGGED_IN)} projectScope />
      </StoryRow>
      <StoryRow
        label="project · inherits and overrides"
        hint="an override takes its inherited row's place, so the list order never jumps"
      >
        <Stage
          environment={SCOPES.atlas.environment}
          projectScope
          inheritedVariables={GLOBAL_VARIABLES}
        />
      </StoryRow>
      <StoryRow
        label="loading"
        hint="no variables yet — every control is disabled until they arrive"
      >
        <Stage environment={null} />
      </StoryRow>
      <StoryRow
        label="could not load"
        hint="the variables request failed; the automatic row still renders from config"
      >
        <Stage environment={null} loadFailed />
      </StoryRow>
    </StoryCard>
  );
}

function RowStage({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-3xl space-y-5">{children}</div>;
}

function draftRow(
  name: string,
  overrides: {
    value?: string | null;
    note?: string | null;
    nameLocked?: boolean;
  } = {},
) {
  return {
    id: name,
    name,
    secret: true as const,
    value: overrides.value ?? null,
    note: overrides.note ?? null,
    nameLocked: overrides.nameLocked ?? true,
  };
}

const rowHandlers = {
  onBlur: noop,
  onNameChange: noop,
  onValueChange: noop,
  onToggleReveal: noop,
  onRemove: noop,
};

export function Rows() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="automatic · logged in"
        hint="read-only name and masked value, a switch in the action slot, and the command that produced it"
      >
        <RowStage>
          <MachineEnvironmentAutomaticRow
            git={LOGGED_IN}
            enabled
            onSetEnabled={noop}
            onOverride={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="automatic · signed out"
        hint="the note slot becomes an alert and the value reads Not available"
      >
        <RowStage>
          <MachineEnvironmentAutomaticRow
            git={SIGNED_OUT}
            enabled
            onSetEnabled={noop}
            onOverride={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="automatic · switched off"
        hint="row and note dim together; the value reads Disabled"
      >
        <RowStage>
          <MachineEnvironmentAutomaticRow
            git={GIT_OFF}
            enabled={false}
            onSetEnabled={noop}
            onOverride={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="automatic · in a project"
        hint="the switch is global, so a project gets an override action in its place"
      >
        <RowStage>
          <MachineEnvironmentAutomaticRow
            git={LOGGED_IN}
            enabled
            projectScope
            onSetEnabled={noop}
            onOverride={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="saved variable"
        hint="the name is locked once saved and the value cannot be revealed until it is replaced"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("ANTHROPIC_API_KEY")}
            index={0}
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="saved variable · with a note"
        hint="notes come from bb machine env set --note; they wrap instead of truncating"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("DATABASE_URL")}
            index={0}
            caption="Points at the staging replica."
            {...rowHandlers}
          />
          <MachineEnvironmentVariableRow
            row={draftRow(LONG_NAME)}
            index={1}
            caption={LONG_NOTE}
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="new variable"
        hint="an unsaved row: the name is editable, the value is empty, and the reveal toggle works"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={{
              id: "new",
              name: "",
              value: "",
              secret: true,
              note: null,
              nameLocked: false,
            }}
            index={1}
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="new variable · revealed"
        hint="the entered value is shown in place; only rows with a pending value can reveal"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("STRIPE_KEY", {
              value: "sk_test_51NcExampleValue",
              nameLocked: false,
            })}
            index={0}
            revealed
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="new variable · rejected"
        hint="the name field goes invalid and the reason sits under the row"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("api key", { value: "", nameLocked: false })}
            index={0}
            error="Use uppercase letters, numbers, and underscores; start with a letter or underscore."
            {...rowHandlers}
          />
          <MachineEnvironmentVariableRow
            row={draftRow("SENTRY_DSN", { value: "", nameLocked: false })}
            index={1}
            error="Variable name already exists."
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="saved variable · GH_TOKEN"
        hint="a hint line explains what this row displaced"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("GH_TOKEN")}
            index={0}
            caption="Overrides the automatic token from the server’s GitHub login."
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="disabled"
        hint="while the section saves or loads, every control in the row is inert"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("SENTRY_DSN")}
            index={0}
            disabled
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="inherited"
        hint="a global variable seen from a project: read-only, masked, and overridable"
      >
        <RowStage>
          <MachineEnvironmentInheritedRow
            variable={secret("ANTHROPIC_API_KEY")}
            onOverride={noop}
          />
          <MachineEnvironmentInheritedRow
            variable={secret("DATABASE_URL", "Points at the staging replica.")}
            onOverride={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow
        label="override"
        hint="an editable row in the inherited row's slot, badged so it reads apart from a project-only variable"
      >
        <RowStage>
          <MachineEnvironmentVariableRow
            row={draftRow("DATABASE_URL")}
            index={0}
            caption={
              <>
                <span className="text-foreground">Override</span> · Points at
                the atlas sandbox.
              </>
            }
            {...rowHandlers}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}
