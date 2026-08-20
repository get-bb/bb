import { registerTimelineRowRenderer } from "../../renderers";
import { SystemRow } from "./SystemRow";

registerTimelineRowRenderer("system", SystemRow);

export { SystemRow } from "./SystemRow";
export {
  leadingIconForSystemRow,
  SYSTEM_DETAIL_COLLAPSED_MAX_LINES,
  systemDetailText,
  systemOperationLeadingIcon,
  type SystemDetailText,
} from "./system-row-model";
