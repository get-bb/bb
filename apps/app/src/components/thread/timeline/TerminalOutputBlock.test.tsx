// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TerminalOutputBlock } from "./TerminalOutputBlock";

afterEach(cleanup);

function renderOutput(output: string): HTMLElement {
  const { container } = render(
    <TerminalOutputBlock
      commandLine=""
      exitCode={null}
      metadataLines={[]}
      output={output}
      streaming={false}
    />,
  );
  return container;
}

it("renders control sequences from real CLI output without leaking them as text", () => {
  const container = renderOutput(
    "\u001b[?25l\u001b]0;pnpm test\u0007\u001b]8;;file:///repo/a.ts\u001b\\\u001b[35ma.ts\u001b[0m\u001b]8;;\u001b\\\r\n" +
      "\u001b[1G\u001b[0KProgress 50%\rProgress 100%\u001b(B\r\n\u001b[?25h",
  );

  expect(container.textContent).toBe("a.ts\nProgress 100%\n");
  expect(container.innerHTML).toContain(
    '<span style="color:var(--ansi-5)">a.ts</span>',
  );
});

it("keeps combined and colon-form colours and ignores underline colours", () => {
  const container = renderOutput(
    "\u001b[1;38;5;196mhot\u001b[0m \u001b[38:2::0:128:255mcool\u001b[0m \u001b[4;58;2;255;0;31mwavy\u001b[0m\n",
  );

  expect(container.textContent).toBe("hot cool wavy\n");
  const html = container.innerHTML;
  expect(html).toContain('<b><span style="color:#ff0000">hot</span></b>');
  expect(html).toContain('<span style="color:#0080ff">cool</span>');
  expect(html).toContain("<u>wavy</u>");
  expect(html).not.toContain("var(--ansi-1)");
});
