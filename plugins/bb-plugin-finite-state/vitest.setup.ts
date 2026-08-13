import { configure } from "@testing-library/react";

// Match loaded CI runners: the default 1s async-utility timeout flakes while
// the suite-level Vitest timeout still bounds real hangs.
configure({ asyncUtilTimeout: 10_000 });
