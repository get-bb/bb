import type { MachineEnvironmentList } from "@bb/server-contract";
import { MachineEnvironmentSettingsContent } from "./MachineEnvironmentSettings";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "settings/Machine Environment",
};

const noop = () => {};
const noopSave = async () => {};

function secret(
  name: string,
  note: string | null = null,
): MachineEnvironmentList["variables"][number] {
  return { name, value: null, secret: true, note };
}

const LOGGED_IN: MachineEnvironmentList = {
  builtInGit: { status: "logged in", statusMessage: "gh is authenticated" },
  variables: [],
};

const NOT_LOGGED_IN: MachineEnvironmentList = {
  builtInGit: { status: "not logged in", statusMessage: "gh is signed out" },
  variables: [],
};

const GIT_DISABLED: MachineEnvironmentList = {
  builtInGit: { status: "disabled", statusMessage: "Automatic token is off" },
  variables: [],
};

const OVERRIDDEN: MachineEnvironmentList = {
  builtInGit: {
    status: "overridden",
    statusMessage: "A GH_TOKEN variable takes precedence",
  },
  variables: [secret("GH_TOKEN")],
};

const SEVERAL: MachineEnvironmentList = {
  builtInGit: { status: "logged in", statusMessage: "gh is authenticated" },
  variables: [
    secret("ANTHROPIC_API_KEY"),
    secret("DATABASE_URL", "Points at the staging replica, not production."),
    secret("SENTRY_DSN"),
  ],
};

function Stage({
  environment,
  loadFailed = false,
  gitCredentialsEnabled = true,
}: {
  environment: MachineEnvironmentList | null;
  loadFailed?: boolean;
  gitCredentialsEnabled?: boolean;
}) {
  return (
    <div className="w-full max-w-3xl">
      <MachineEnvironmentSettingsContent
        environment={environment}
        loadFailed={loadFailed}
        gitCredentialsEnabled={gitCredentialsEnabled}
        onSave={noopSave}
        onSetGitCredentials={noop}
      />
    </div>
  );
}

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="automatic token only"
        hint="no user variables — the GH_TOKEN row is read-only and its note stays on one line"
      >
        <Stage environment={LOGGED_IN} />
      </StoryRow>
      <StoryRow
        label="github signed out"
        hint="an alert in the same slot as the note; it truncates like every other status"
      >
        <Stage environment={NOT_LOGGED_IN} />
      </StoryRow>
      <StoryRow
        label="automatic token off"
        hint="the switch is off, so the row and its note dim together"
      >
        <Stage environment={GIT_DISABLED} gitCredentialsEnabled={false} />
      </StoryRow>
      <StoryRow
        label="overridden by a variable"
        hint="a user GH_TOKEN replaces the automatic row entirely and explains itself"
      >
        <Stage environment={OVERRIDDEN} />
      </StoryRow>
      <StoryRow
        label="several variables"
        hint="saved secrets never return a value; one carries a note"
      >
        <Stage environment={SEVERAL} />
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
