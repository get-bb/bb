import { fileURLToPath } from "node:url";

export const INSTALL_MACHINE_SCRIPT_PATH = fileURLToPath(
  new URL("./assets/install-machine.sh", import.meta.url),
);

export const INSTALL_MACHINE_WINDOWS_SCRIPT_PATH = fileURLToPath(
  new URL("./assets/install-machine-windows.mjs", import.meta.url),
);
