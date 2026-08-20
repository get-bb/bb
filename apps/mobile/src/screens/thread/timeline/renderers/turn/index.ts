import { registerTimelineRowRenderer } from "../../renderers";
import { TurnRow } from "./TurnRow";

registerTimelineRowRenderer("turn", TurnRow);

export { TurnRow } from "./TurnRow";
