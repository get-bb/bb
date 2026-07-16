import { configure } from "@testing-library/react";

// Match slow CI runners: the default 1s async-utility timeout flakes there
// while the suite-level vitest testTimeout still bounds real hangs.
configure({ asyncUtilTimeout: 8_000 });
