import { experimental_sandboxTempDir } from "./packages/plugin-sdk/src/testing/vitest-global-setup.js";
import { killProcessesReferencingPath } from "./packages/test-helpers/src/process-sweep.js";

export default function setup(): () => Promise<void> {
  return experimental_sandboxTempDir({
    beforeRemove: killProcessesReferencingPath,
  });
}
