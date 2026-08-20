import { registerTimelineRowRenderer } from "../../renderers";
import { SummaryRow } from "./SummaryRow";

registerTimelineRowRenderer("step-summary", SummaryRow);
registerTimelineRowRenderer("bundle-summary", SummaryRow);

export { SummaryRow } from "./SummaryRow";
