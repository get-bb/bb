import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [execPath, , logPath, target, ...args] = process.argv;
appendFileSync(logPath, `${JSON.stringify({ args, env: process.env })}\n`);
process.argv = [execPath, target, ...args];
await import(pathToFileURL(target).href);
