import pc from "picocolors";

export const { bold, cyan, dim, green, red, yellow } = pc.createColors(
  pc.isColorSupported &&
    (Boolean(process.stdout.isTTY) ||
      Boolean(process.env.FORCE_COLOR) ||
      process.argv.includes("--color")),
);

export function log(icon: string, message: string): void {
  process.stdout.write(`  ${icon}  ${message}\n`);
}

export function beginStep(message: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b[2K  ${dim("○")}  ${message}\r`);
  } else {
    log(dim("○"), message);
  }
}

export function endStep(icon: string, message: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2K");
  }
  log(icon, message);
}
