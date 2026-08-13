import type { MockHandlerRegistry } from "../types.js";
import { registerBomHandlers } from "./bom.js";
import { registerFindingHandlers } from "./findings.js";
import { registerProjectHandlers } from "./projects.js";
import type { MockPlatformState } from "./state.js";
import { registerVexHandlers } from "./vex.js";

export function registerPlatformHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registerProjectHandlers(registry, state);
  registerFindingHandlers(registry, state);
  registerVexHandlers(registry, state);
  registerBomHandlers(registry, state);
  registry.onReset(() => state.reset());
}
