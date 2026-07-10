import {
  MODEL_PICKER_SELECT_APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
  type AppCommandId,
} from "@bb/domain";

export interface AppCommandMetadata {
  command: AppCommandId;
  description: string;
  label: string;
}

export interface AppCommandGroup {
  commands: readonly AppCommandMetadata[];
  label: string;
}

function command(
  id: AppCommandId,
  label: string,
  description: string,
): AppCommandMetadata {
  return { command: id, description, label };
}

export const APP_COMMAND_GROUPS: readonly AppCommandGroup[] = [
  {
    label: "Threads",
    commands: [
      command(
        "thread.new",
        "New thread",
        "Start a thread in the active project.",
      ),
      command(
        "thread.search",
        "Search threads",
        "Focus the sidebar thread search.",
      ),
      command(
        "thread.previous",
        "Previous thread",
        "Open the previous visible sidebar thread.",
      ),
      command(
        "thread.next",
        "Next thread",
        "Open the next visible sidebar thread.",
      ),
      ...THREAD_JUMP_APP_COMMAND_IDS.map((id, index) =>
        command(
          id,
          `Open thread ${index + 1}`,
          `Open visible sidebar thread ${index + 1}.`,
        ),
      ),
    ],
  },
  {
    label: "Window and layout",
    commands: [
      command("window.new", "New window", "Open another bb desktop window."),
      command("settings.open", "Open settings", "Open bb settings."),
      command(
        "sidebar.toggle",
        "Toggle sidebar",
        "Show or hide the app sidebar.",
      ),
      command(
        "panel.newTab",
        "New panel tab",
        "Open a tab in the secondary panel.",
      ),
      command(
        "panel.close",
        "Close panel tab",
        "Close the active panel tab or terminal.",
      ),
      command(
        "panel.toggle",
        "Toggle panel",
        "Show or hide the secondary panel.",
      ),
    ],
  },
  {
    label: "Workspace",
    commands: [
      command(
        "file.quickOpen",
        "Quick open file",
        "Search workspace files in a new panel tab.",
      ),
      command(
        "diff.toggle",
        "Toggle diff",
        "Open or close the environment diff.",
      ),
      command(
        "terminal.open",
        "Open terminal",
        "Open a terminal in the secondary panel.",
      ),
      command(
        "workspace.openPreferred",
        "Open in preferred app",
        "Open the workspace in the preferred editor or terminal.",
      ),
    ],
  },
  {
    label: "Composer and models",
    commands: [
      command(
        "modelPicker.toggle",
        "Toggle model picker",
        "Open or close the focused composer's model picker.",
      ),
      ...MODEL_PICKER_SELECT_APP_COMMAND_IDS.map((id, index) =>
        command(
          id,
          `Choose model ${index + 1}`,
          `Choose visible model ${index + 1} while the picker is open.`,
        ),
      ),
    ],
  },
  {
    label: "Browser",
    commands: [
      command(
        "browser.focusLocation",
        "Focus location",
        "Focus the embedded browser address bar.",
      ),
      command(
        "browser.reload",
        "Reload page",
        "Reload the active embedded browser page.",
      ),
    ],
  },
  {
    label: "Questions",
    commands: QUESTION_SELECT_APP_COMMAND_IDS.map((id, index) =>
      command(
        id,
        `Choose answer ${index + 1}`,
        `Choose visible answer ${index + 1} when bb asks a question.`,
      ),
    ),
  },
];

const APP_COMMAND_METADATA = new Map(
  APP_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((metadata) => [metadata.command, metadata]),
  ),
);

export function getAppCommandMetadata(
  commandId: AppCommandId,
): AppCommandMetadata {
  const metadata = APP_COMMAND_METADATA.get(commandId);
  if (metadata === undefined) {
    throw new Error(`Missing metadata for app command ${commandId}`);
  }
  return metadata;
}
