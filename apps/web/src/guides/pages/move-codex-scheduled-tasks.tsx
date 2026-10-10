import type { Guide } from "../guide-types";
import { MOVE_TASKS_TOOLS, moveTasksGuide } from "../shared/move-tasks";
import { meta } from "./move-codex-scheduled-tasks.meta";

export const guide: Guide = moveTasksGuide(meta, MOVE_TASKS_TOOLS["codex-app"]);
