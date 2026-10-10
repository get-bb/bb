import { describe, expect, it } from "vitest";
import { formatShellCommandForDisplay } from "../src/shell-command-display.js";

describe("formatShellCommandForDisplay", () => {
  it("keeps short commands on one line", () => {
    expect(
      formatShellCommandForDisplay("cd apps/app && pnpm test | tail"),
    ).toBe("cd apps/app && pnpm test | tail");
  });

  it("puts each chained command of a long one-liner on its own line", () => {
    expect(
      formatShellCommandForDisplay(
        "cd apps/app && pnpm exec turbo run test --filter=@bb/app || echo failed; git status --short",
      ),
    ).toBe(
      "cd apps/app &&\n  pnpm exec turbo run test --filter=@bb/app ||\n  echo failed;\n  git status --short",
    );
  });

  it("splits a pipeline only when its line stays too long", () => {
    expect(
      formatShellCommandForDisplay(
        "cd packages/thread-view && pnpm exec vitest run test/shell-command-display 2>&1 | tail -40",
      ),
    ).toBe(
      "cd packages/thread-view &&\n  pnpm exec vitest run test/shell-command-display 2>&1 | tail -40",
    );
    expect(
      formatShellCommandForDisplay(
        'rg --no-heading --line-number "formatShellCommand" packages apps plugins |& sort | uniq -c | head -20',
      ),
    ).toBe(
      'rg --no-heading --line-number "formatShellCommand" packages apps plugins |&\n  sort |\n  uniq -c |\n  head -20',
    );
  });

  it.each([
    [
      'git commit -m "fix: keep a && b | c; together" && git push origin feature/long-branch-name',
      'git commit -m "fix: keep a && b | c; together" &&\n  git push origin feature/long-branch-name',
    ],
    [
      'echo \'single && quoted | text; stays\' && echo "$(git log -1 | head -1 && echo "x && y")"',
      'echo \'single && quoted | text; stays\' &&\n  echo "$(git log -1 | head -1 && echo "x && y")"',
    ],
    [
      "(cd packages/thread-view && pnpm test) && echo `git rev-parse HEAD | cut -c1-8` && echo ${HOME:-$(pwd)}",
      "(cd packages/thread-view && pnpm test) &&\n  echo `git rev-parse HEAD | cut -c1-8` &&\n  echo ${HOME:-$(pwd)}",
    ],
    [
      'for f in src/*.ts; do wc -l "$f"; done | sort -n && if [[ -f a && -f b ]]; then echo both; fi',
      'for f in src/*.ts; do wc -l "$f"; done | sort -n &&\n  if [[ -f a && -f b ]]; then echo both; fi',
    ],
    [
      "find . -name '*.log' -exec rm {} \\; && cat <(ls -la) 2>&1 >| out.txt && echo done-cleaning-up",
      "find . -name '*.log' -exec rm {} \\; &&\n  cat <(ls -la) 2>&1 >| out.txt &&\n  echo done-cleaning-up",
    ],
    [
      "pnpm exec turbo run test --filter=@bb/app && echo done && pnpm exec turbo run lint",
      "pnpm exec turbo run test --filter=@bb/app &&\n  echo done &&\n  pnpm exec turbo run lint",
    ],
    [
      "pnpm exec turbo run typecheck --filter=@bb/thread-view && echo ok # && the rest is a comment",
      "pnpm exec turbo run typecheck --filter=@bb/thread-view &&\n  echo ok # && the rest is a comment",
    ],
  ])("splits only at top-level operators: %s", (command, expected) => {
    expect(formatShellCommandForDisplay(command)).toBe(expected);
  });

  it.each([
    "cat > notes.txt <<'EOF' && echo written to a file with a fairly long trailing command\nhello\nEOF",
    "echo 'unterminated quote && this keeps going until the end of a really long command",
    "echo $(unbalanced substitution && this keeps going until the end of a long command",
    "case $mode in fast) pnpm test && echo fast;; slow) pnpm exec turbo run test;; esac",
  ])("leaves commands it cannot safely reflow unchanged: %s", (command) => {
    expect(formatShellCommandForDisplay(command)).toBe(command);
  });
});
