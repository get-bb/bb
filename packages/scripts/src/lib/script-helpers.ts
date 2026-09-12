import readline from "node:readline/promises";
import pc from "picocolors";

type Formatter = (value: string) => string;

interface ConfirmTypedWordArgs {
  renderIntro: () => void;
  word: string;
}

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

export async function confirmTypedWord(
  args: ConfirmTypedWordArgs,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Interactive confirmation requires a TTY. Re-run with --yes to confirm.",
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    args.renderIntro();
    const answer = await rl.question(
      `  ${dim("?")}  Type ${bold(`"${args.word}"`)} to continue: `,
    );
    return answer.trim() === args.word;
  } finally {
    rl.close();
  }
}
