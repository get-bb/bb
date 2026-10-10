import type { Guide } from "../guide-types";
import { MOVE_TASKS_TOOLS, moveTasksGuide } from "../shared/move-tasks";
import { meta } from "./move-claude-code-routines.meta";

export const guide: Guide = moveTasksGuide(meta, MOVE_TASKS_TOOLS["claude"]);
