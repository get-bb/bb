import { useState, type ReactNode } from "react";
import {
  pluginRuntimeStatusSchema,
  pluginUpdateOutcomeSchema,
  skillScopeSchema,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceInstallControl,
  ResourceInstalledControl,
  ResourceLifecycleStatus,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { AutomationRunStatusIndicator } from "bb-plugin-automations/detail-view";
import {
  automationRunModeSchema,
  automationRunStatusSchema,
} from "bb-plugin-automations/rpc-types";
import { StoryCard, type StoryRowProps } from "../../../.ladle/story-card";
import {
  PluginRowSignalView,
  PluginSignalLogo,
} from "@/components/plugin/management/PluginRowSignal";
import { PlaceholderBadge } from "@/components/plugin/management/plugin-ui";
import {
  pluginRuntimeStatusDefinition,
  type PluginRowSignal,
} from "@/components/plugin/management/plugin-status";
import {
  SKILL_SCOPE_LABELS,
  SKILL_SCOPE_OWNERSHIP,
} from "@/components/tools/skill-taxonomy";
import {
  formatAutomationTrigger,
  formatScheduleStatusLabel,
  type AutomationTrigger,
} from "@/lib/format-schedule";

export default {
  title: "Tools/State galleries",
};

const noop = () => {};

function StoryRow({ label, hint, children, className }: StoryRowProps) {
  return (
    <div
      className={[
        "grid grid-cols-[var(--story-label-width,210px)_minmax(0,1fr)] items-stretch max-[600px]:grid-cols-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 flex-col gap-0.5 border-r border-border bg-surface-recessed/55 px-4 py-3 max-[600px]:border-r-0 max-[600px]:border-b">
        <span className="mb-1 hidden text-2xs font-semibold uppercase tracking-wide text-subtle-foreground max-[600px]:block">
          Documentation
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint ? (
          <span className="text-xs break-words text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
        <span className="hidden basis-full text-2xs font-semibold uppercase tracking-wide text-subtle-foreground max-[600px]:block">
          Rendered UI
        </span>
        {children}
      </div>
    </div>
  );
}

function Gallery({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-6">
      <header>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </main>
  );
}

function StateSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <StoryCard className="m-0 divide-y divide-border border border-border bg-card">
        <div className="grid grid-cols-[var(--story-label-width,210px)_minmax(0,1fr)] max-[600px]:hidden">
          <span className="flex flex-col border-r border-border bg-surface-recessed px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Documentation
            </span>
            <span className="text-2xs text-subtle-foreground">
              State and meaning
            </span>
          </span>
          <span className="flex flex-col bg-card px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rendered UI
            </span>
            <span className="text-2xs text-subtle-foreground">
              Actual component
            </span>
          </span>
        </div>
        {children}
      </StoryCard>
    </section>
  );
}

function SurfaceRule({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs italic text-subtle-foreground">{children}</span>
  );
}

function AbsentPreview({ label }: { label: string }) {
  return (
    <span aria-label={label} className="text-sm text-subtle-foreground">
      —
    </span>
  );
}

function StatefulSwitch({
  initialChecked,
  disabled = false,
  label,
}: {
  initialChecked: boolean;
  disabled?: boolean;
  label: string;
}) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={setChecked}
      aria-label={label}
    />
  );
}

function InstallStates() {
  return (
    <>
      <StoryRow label="available" hint="Resource is not installed">
        <ResourceInstallControl
          accessibleLabel="Install resource"
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="installing" hint="Install mutation is pending">
        <ResourceInstallControl
          accessibleLabel="Installing resource"
          pending
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="incompatible" hint="Install is unavailable">
        <ResourceInstallControl
          accessibleLabel="Resource is incompatible"
          disabled
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="installed" hint="Installed, but not removable here">
        <ResourceInstalledControl accessibleLabel="Resource installed" />
      </StoryRow>
      <StoryRow
        label="installed · removable"
        hint="Hover or focus the control to reveal Uninstall"
      >
        <ResourceInstalledControl
          accessibleLabel="Uninstall resource"
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="uninstalling" hint="Removal mutation is pending">
        <ResourceInstalledControl
          accessibleLabel="Uninstalling resource"
          pending
          onAction={noop}
        />
      </StoryRow>
    </>
  );
}

function pluginRuntimeSignal(
  status: (typeof pluginRuntimeStatusSchema.options)[number],
): Extract<PluginRowSignal, { kind: "status" }> | null {
  const definition = pluginRuntimeStatusDefinition(status);
  return definition === null
    ? null
    : {
        kind: "status",
        icon: definition.icon,
        label: definition.label,
        tone: definition.tone,
        detail: null,
      };
}

const PLUGIN_RUNTIME_STATUS_HINTS = {
  running: "Healthy · Represented by the lifecycle toggle",
  error: "Cannot run · Startup or execution failed",
  incompatible: "Cannot run · Not compatible with this bb version",
  missing: "Cannot run · Installed source is unavailable",
  disabled: "Disabled · Represented by the lifecycle toggle",
  "needs-configuration": "Needs attention · Required settings are incomplete",
  degraded: "Needs attention · Running with reduced functionality",
} satisfies Record<(typeof pluginRuntimeStatusSchema.options)[number], string>;

export function Plugins() {
  return (
    <Gallery
      title="Plugin states"
      description="Every row comes from the plugin contract or a real mutation transition. Running and disabled stay in the lifecycle control; health and release never collapse into a generic attention badge."
    >
      <StateSection
        title="Installation"
        description="One shared install control is used by browse and detail surfaces."
      >
        <InstallStates />
      </StateSection>

      <StateSection
        title="Lifecycle"
        description="Enablement is an interactive compact toggle, not a written runtime badge."
      >
        <StoryRow label="running" hint="Enabled and healthy">
          <StatefulSwitch initialChecked label="Disable plugin" />
          <SurfaceRule>No written status</SurfaceRule>
        </StoryRow>
        <StoryRow label="disabled" hint="Installed but not enabled">
          <StatefulSwitch initialChecked={false} label="Enable plugin" />
          <SurfaceRule>No written status</SurfaceRule>
        </StoryRow>
        <StoryRow label="changing" hint="Enable/disable mutation is pending">
          <StatefulSwitch
            initialChecked
            disabled
            label="Changing plugin state"
          />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Runtime health"
        description="Five abnormal contract states use two visual severities: red means the plugin cannot run; amber means it needs attention. Healthy and disabled stay quiet."
      >
        {pluginRuntimeStatusSchema.options.map((status) => {
          const signal = pluginRuntimeSignal(status);
          return (
            <StoryRow
              key={status}
              label={status}
              hint={PLUGIN_RUNTIME_STATUS_HINTS[status]}
            >
              {signal === null ? (
                <SurfaceRule>No health icon</SurfaceRule>
              ) : (
                <PluginSignalLogo signal={signal} onStatusClick={noop}>
                  <PlaceholderBadge className="size-6" iconName="Puzzle" />
                </PluginSignalLogo>
              )}
            </StoryRow>
          );
        })}
      </StateSection>

      <StateSection
        title="Release"
        description="Update availability is an action. Quiet outcomes stay in the Release section instead of becoming list badges."
      >
        {pluginUpdateOutcomeSchema.options.map((outcome) => (
          <StoryRow key={outcome} label={outcome} hint="Server update outcome">
            {outcome === "update-available" ? (
              <PluginRowSignalView
                signal={{ kind: "update", version: "{version}" }}
                onUpdateClick={noop}
                onStatusClick={noop}
              />
            ) : (
              <SurfaceRule>Release section only · no row signal</SurfaceRule>
            )}
          </StoryRow>
        ))}
        <StoryRow
          label="update failed"
          hint="A failed update rolled back to the installed version"
        >
          <PluginRowSignalView
            signal={{
              kind: "status",
              icon: "RotateCcw",
              label: "Update failed",
              tone: "error",
              detail: null,
            }}
            onUpdateClick={noop}
            onStatusClick={noop}
          />
        </StoryRow>
      </StateSection>
    </Gallery>
  );
}

function SkillProvenanceTreatment({
  scope,
}: {
  scope: (typeof skillScopeSchema.options)[number];
}) {
  if (scope === "plugin") {
    return (
      <ResourceLifecycleStatus
        label="Included"
        icon="PackageReceive"
        accessibleLabel="Included with Documents (Codex plugin)"
        tooltip="Included with Documents (Codex plugin)"
      />
    );
  }
  if (scope === "bb-builtin") {
    return (
      <ResourceLifecycleStatus
        label="Built-in"
        icon="PackageReceive"
        tooltip="Ships with bb"
      />
    );
  }
  if (scope.startsWith("claude") || scope.startsWith("codex")) {
    return (
      <ResourceLifecycleStatus
        label="Imported"
        icon="Download"
        tooltip={`Discovered from ${scope.startsWith("claude") ? "Claude Code" : "Codex"}`}
      />
    );
  }
  return <AbsentPreview label="No provenance label is rendered" />;
}

function SkillEditAction() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={noop}>
      Edit
    </Button>
  );
}

export function Skills() {
  return (
    <Gallery
      title="Skill states"
      description="Provenance and editability are independent: provider skills remain imported even when their source is writable and bb can edit them."
    >
      <StateSection
        title="Installation"
        description="Registry skills use the same shared install lifecycle as plugins."
      >
        <InstallStates />
      </StateSection>

      <StateSection
        title="Provenance"
        description="Each server scope maps to one provenance treatment. Editability never changes this label."
      >
        {skillScopeSchema.options.map((scope) => {
          return (
            <StoryRow
              key={scope}
              label={scope}
              hint={`${SKILL_SCOPE_LABELS[scope]} · ${SKILL_SCOPE_OWNERSHIP[scope]}`}
            >
              <SkillProvenanceTreatment scope={scope} />
            </StoryRow>
          );
        })}
      </StateSection>

      <StateSection
        title="Editability"
        description="The Edit action is present only when bb can write the skill source. Read-only resources render no edit control."
      >
        <StoryRow
          label="bb-owned"
          hint="bb-user or bb-project · Always editable"
        >
          <SkillEditAction />
        </StoryRow>
        <StoryRow
          label="provider-owned · writable"
          hint="Claude or Codex user/project skill · Editable"
        >
          <SkillEditAction />
        </StoryRow>
        <StoryRow
          label="provider-owned · read-only"
          hint="Claude or Codex user/project skill · Source is not writable"
        >
          <AbsentPreview label="No Edit action is rendered" />
        </StoryRow>
        <StoryRow
          label="system-owned"
          hint="bb-builtin or plugin scope · Always read-only"
        >
          <AbsentPreview label="No Edit action is rendered" />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Content"
        description="The required file viewer has explicit asynchronous and editing states."
      >
        <StoryRow label="loading" hint="File content request in flight">
          <ResourceLifecycleStatus label="Loading SKILL.md…" />
        </StoryRow>
        <StoryRow label="ready" hint="Rendered file viewer">
          <ResourceLifecycleStatus label="SKILL.md" />
        </StoryRow>
        <StoryRow label="editing" hint="Editable user-owned SKILL.md">
          <Button type="button" size="sm" onClick={noop}>
            Save
          </Button>
        </StoryRow>
        <StoryRow label="error" hint="File content could not be loaded">
          <Button type="button" variant="outline" size="sm" onClick={noop}>
            Retry
          </Button>
        </StoryRow>
      </StateSection>
    </Gallery>
  );
}

function AutomationMode({
  mode,
}: {
  mode: (typeof automationRunModeSchema.options)[number];
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-foreground">
      <Icon
        name={mode === "agent" ? "Calendar" : "ComputerTerminal01"}
        className="size-4 text-muted-foreground"
        aria-hidden
      />
      {mode === "agent" ? "Agent prompt" : "Script"}
    </span>
  );
}

const RECURRING_TRIGGER = {
  triggerType: "schedule",
  cron: "0 9 * * 1-5",
  timezone: "America/Los_Angeles",
} satisfies AutomationTrigger;

const ONE_TIME_TRIGGER = {
  triggerType: "once",
  runAt: new Date(2027, 0, 16, 14, 30).getTime(),
} satisfies AutomationTrigger;

const NEXT_RUN_AT = new Date(2027, 0, 15, 9).getTime();

function AutomationTriggerPreview({ trigger }: { trigger: AutomationTrigger }) {
  return (
    <span className="text-xs leading-snug text-muted-foreground">
      {formatAutomationTrigger(trigger)}
    </span>
  );
}

export function Automations() {
  return (
    <Gallery
      title="Automation states"
      description="Lifecycle, execution definition, schedule, and run history remain separate so a simple automation and a complex script automation use the same system."
    >
      <StateSection
        title="Enablement control"
        description="The compact switch is the only pause/resume control. It is separate from read-only schedule summaries."
      >
        <StoryRow label="enabled" hint="The automation may be scheduled">
          <StatefulSwitch initialChecked label="Pause automation" />
        </StoryRow>
        <StoryRow label="paused" hint="Retained, but disabled">
          <StatefulSwitch initialChecked={false} label="Resume automation" />
        </StoryRow>
        <StoryRow
          label="completed one-time"
          hint="A completed one-time automation cannot be resumed"
        >
          <StatefulSwitch
            initialChecked={false}
            disabled
            label="Completed automation"
          />
        </StoryRow>
        <StoryRow label="changing" hint="Pause/resume mutation is pending">
          <StatefulSwitch
            initialChecked
            disabled
            label="Changing automation state"
          />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Schedule summary"
        description="Read-only overview text derived from enablement, trigger, run history, and the next run timestamp. These are summaries, not separate workflow states or controls."
      >
        <StoryRow label="next run" hint="Enabled with a future run">
          <ResourceLifecycleStatus
            label={formatScheduleStatusLabel({
              enabled: true,
              nextRunAt: NEXT_RUN_AT,
              trigger: RECURRING_TRIGGER,
            })}
          />
        </StoryRow>
        <StoryRow label="paused" hint="Disabled before completion">
          <ResourceLifecycleStatus
            label={formatScheduleStatusLabel({
              enabled: false,
              nextRunAt: NEXT_RUN_AT,
              trigger: RECURRING_TRIGGER,
            })}
          />
        </StoryRow>
        <StoryRow
          label="not scheduled"
          hint="Enabled, but no future run is available"
        >
          <ResourceLifecycleStatus
            label={formatScheduleStatusLabel({
              enabled: true,
              nextRunAt: null,
              trigger: RECURRING_TRIGGER,
            })}
          />
        </StoryRow>
        <StoryRow
          label="completed"
          hint="A one-time automation has already run"
        >
          <ResourceLifecycleStatus
            label={formatScheduleStatusLabel({
              enabled: false,
              nextRunAt: null,
              trigger: ONE_TIME_TRIGGER,
              runCount: 1,
            })}
          />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Execution"
        description="The definition section switches between the composer-style prompt and the script form."
      >
        {automationRunModeSchema.options.map((mode) => (
          <StoryRow
            key={mode}
            label={mode}
            hint={
              mode === "agent"
                ? "Prompt composer"
                : "Interpreter, timeout, and script"
            }
          >
            <AutomationMode mode={mode} />
          </StoryRow>
        ))}
      </StateSection>

      <StateSection
        title="Trigger"
        description="Compact definition metadata says when the automation runs. It is neither a lifecycle state nor runtime health."
      >
        <StoryRow label="recurring" hint="Cron cadence and timezone">
          <AutomationTriggerPreview trigger={RECURRING_TRIGGER} />
        </StoryRow>
        <StoryRow label="one-time" hint="A single scheduled timestamp">
          <AutomationTriggerPreview trigger={ONE_TIME_TRIGGER} />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Run history"
        description="Every persisted run status from the automation contract, plus the empty history state."
      >
        <StoryRow label="no runs" hint="No persisted run history yet">
          <ResourceLifecycleStatus label="No runs yet" />
        </StoryRow>
        {automationRunStatusSchema.options.map((status) => (
          <StoryRow key={status} label={status} hint="Persisted run outcome">
            <AutomationRunStatusIndicator status={status} showLabel />
          </StoryRow>
        ))}
      </StateSection>
    </Gallery>
  );
}
