import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Select",
};

const ENVIRONMENT_LABELS: Record<string, string> = {
  "project-default": "Project default",
  "new-worktree": "New worktree",
};

function EnvironmentKindSelect() {
  const [value, setValue] = useState("project-default");
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Execution environment" className="h-8 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(ENVIRONMENT_LABELS).map(([kind, label]) => (
          <SelectItem key={kind} value={kind}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MACHINES = [
  { id: "m_local", name: "Local" },
  { id: "m_prod-1", name: "prod-1" },
];
const DEFAULT_MACHINE_VALUE = "__default-machine__";

function MachineSelect() {
  const [value, setValue] = useState(DEFAULT_MACHINE_VALUE);
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Machine" className="h-8 w-56">
        <SelectValue placeholder="Machine" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MACHINE_VALUE}>Default machine</SelectItem>
        {MACHINES.map((machine) => (
          <SelectItem key={machine.id} value={machine.id}>
            {machine.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const FOLDERS = [
  { id: "f_design", name: "Design" },
  { id: "f_backend", name: "Backend" },
];
const NO_FOLDER = "__no-folder__";
const NEW_FOLDER = "__new-folder__";

function FolderSelect() {
  const [value, setValue] = useState(NO_FOLDER);
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Folder" className="h-8 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER}>No folder</SelectItem>
        {FOLDERS.map((folder) => (
          <SelectItem key={folder.id} value={folder.id}>
            {folder.name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW_FOLDER}>New folder…</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Execution environment"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — a fixed set of options"
      >
        <EnvironmentKindSelect />
      </StoryRow>
      <StoryRow
        label="Machine"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — a data-driven list with a synthetic default value"
      >
        <MachineSelect />
      </StoryRow>
      <StoryRow
        label="Folder"
        hint="plugins/tasks/views/manage/new-project-dialog.tsx — a separator dividing a list from a trailing action item"
      >
        <FolderSelect />
      </StoryRow>
    </StoryCard>
  );
}
