// Creation + management surfaces. The shell (shell/app-shell.tsx) mounts the
// two dialogs; ManagePanel is exported for the future manage route/slot (see
// its doc comment).

export {
  NewTaskDialog,
  type NewTaskDialogProps,
} from "./new-task-dialog.js";
export {
  NewProjectDialog,
  type NewProjectDialogProps,
} from "./new-project-dialog.js";
export { ManagePanel } from "./manage-panel.js";
