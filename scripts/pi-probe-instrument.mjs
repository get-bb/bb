import { readFileSync, writeFileSync } from 'node:fs';
const file = 'plugins/provider-pi/src/bridge/test-support.ts';
let source = readFileSync(file, 'utf8');
source = source.replace('import { existsSync, mkdtempSync, readFileSync } from "node:fs";', 'import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";');
const marker = '      children.push(message.process);';
if (!source.includes(marker)) throw new Error('child observation marker missing');
source = source.replace(marker, `${marker}
      const probeDir = process.env.PI_PROBE_DIR;
      if (probeDir) {
        mkdirSync(probeDir, { recursive: true });
        const child = message.process;
        const probePath = join(probeDir, \`child-\${process.pid}-\${children.length}-\${Date.now()}.jsonl\`);
        const record = (event: string, data: Record<string, unknown>) => {
          appendFileSync(probePath, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\\n");
        };
        child.once("spawn", () => {
        record("spawn", { pid: child.pid, parentPid: process.pid });
        child.stdout?.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          record("stdout", { bytes: Buffer.byteLength(text), getState: text.includes('"command":"get_state"') });
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          const timings = text.split(/\\r?\\n/).filter((line) => /^\\s*(--- Startup Timings:|[\\w.]+:\\s*\\d+ms|TOTAL:\\s*\\d+ms)/.test(line));
          record("stderr", { bytes: Buffer.byteLength(text), timings });
        });
        });
        child.on("exit", (code, signal) => record("exit", { code, signal }));
        child.on("error", (error) => record("error", { message: error.message }));
      }
`);
writeFileSync(file, source);
