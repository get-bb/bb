/**
 * Work-row renderers (`work:<workKind>`). Importing this module registers
 * them with the timeline renderer registry; `../index.ts` imports it.
 */
import { registerTimelineRowRenderer } from "../../renderers";
import { ApprovalWorkRow } from "./ApprovalWorkRow";
import { CommandWorkRow } from "./CommandWorkRow";
import { DelegationWorkRow } from "./DelegationWorkRow";
import { FileChangeWorkRow } from "./FileChangeWorkRow";
import { ImageViewWorkRow } from "./ImageViewWorkRow";
import { QuestionWorkRow } from "./QuestionWorkRow";
import { ToolWorkRow } from "./ToolWorkRow";
import { WebFetchWorkRow, WebSearchWorkRow } from "./WebWorkRows";
import { WorkflowWorkRow } from "./WorkflowWorkRow";

registerTimelineRowRenderer("work:command", CommandWorkRow);
registerTimelineRowRenderer("work:tool", ToolWorkRow);
registerTimelineRowRenderer("work:file-change", FileChangeWorkRow);
registerTimelineRowRenderer("work:web-search", WebSearchWorkRow);
registerTimelineRowRenderer("work:web-fetch", WebFetchWorkRow);
registerTimelineRowRenderer("work:image-view", ImageViewWorkRow);
registerTimelineRowRenderer("work:approval", ApprovalWorkRow);
registerTimelineRowRenderer("work:question", QuestionWorkRow);
registerTimelineRowRenderer("work:delegation", DelegationWorkRow);
registerTimelineRowRenderer("work:workflow", WorkflowWorkRow);

export {
  WorkflowPhaseStrip,
  WorkflowProgressView,
} from "./WorkflowProgressView";
export { workflowBodyKind } from "./work-row-model";
