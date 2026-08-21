import pc from "picocolors";

type Formatter = (value: string) => string;

export const dim: Formatter = pc.dim;
export const bold: Formatter = pc.bold;
export const green: Formatter = pc.green;
export const cyan: Formatter = pc.cyan;
export const yellow: Formatter = pc.yellow;

export function log(icon: string, msg: string): void {
  process.stdout.write(`  ${icon}  ${msg}\n`);
}

export function endStep(icon: string, msg: string): void {
  process.stdout.write(`\x1b[2K  ${icon}  ${msg}\n`);
}
