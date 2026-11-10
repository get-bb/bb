import { fileURLToPath } from "node:url";
import { listQueryFunctions } from "./query-functions.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

process.stdout.write(`${JSON.stringify(listQueryFunctions(REPO_ROOT))}\n`);
