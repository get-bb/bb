import { defineSplit } from "@/lib/define-split";
import type { ProjectPathDialogProps } from "./ProjectPathDialog";

export const LazyProjectPathDialog = defineSplit<ProjectPathDialogProps>({
  id: "project-path-dialog",
  tier: "preload",
  load: () =>
    import("./ProjectPathDialog").then((module) => module.ProjectPathDialog),
  loading: () => null,
  mountWhen: (props) => props.target !== null,
  keepMounted: true,
});
