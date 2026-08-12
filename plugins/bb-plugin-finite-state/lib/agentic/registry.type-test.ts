import type {
  ActionToolName,
  AgentToolClass,
} from "./registry.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

export type ActionToolNamesAreExactlyClosed = Expect<
  Equal<
    ActionToolName,
    "fs_verification_run" | "fs_bench_run" | "fs_firmware_materialize"
  >
>;

const action: AgentToolClass<"fs_bench_run"> = "action";
const read: AgentToolClass<"fs_sync_plan"> = "read";

// @ts-expect-error A fourth action is outside the closed ActionToolName union.
const fourthAction: AgentToolClass<"fs_sync_plan"> = "action";
// @ts-expect-error Unknown action identifiers are rejected at compile time.
const unknownAction: ActionToolName = "fs_other_run";

void [action, read, fourthAction, unknownAction];
