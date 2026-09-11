import { expect, it } from "vitest";
import { defaultUrlTransform } from "react-markdown";
import { collectMarkdownImages } from "./markdown-images";

it("collects inline and table images in order, including repeated URLs and references", () => {
  expect(
    collectMarkdownImages(
      `![Inline](https://example.com/a.png)

| Preview | Version |
| --- | --- |
| ![Table][preview] | First |
| ![Repeated](https://example.com/a.png) | Second |

[preview]: https://example.com/b.png
`,
      defaultUrlTransform,
    ),
  ).toEqual([
    { src: "https://example.com/a.png", alt: "Inline" },
    { src: "https://example.com/b.png", alt: "Table" },
    { src: "https://example.com/a.png", alt: "Repeated" },
  ]);
});

it("excludes code, math, raw HTML, unresolved references and unsafe URLs", () => {
  expect(
    collectMarkdownImages(
      `\`![Code](https://example.com/code.png)\`

\`\`\`md
![Fenced](https://example.com/fenced.png)
\`\`\`

$$
![Math](https://example.com/math.png)
$$

<img src="https://example.com/html.png" />

![Missing][unknown]

![Unsafe](javascript:alert)

![Visible](https://example.com/visible.png)
`,
      defaultUrlTransform,
    ),
  ).toEqual([{ src: "https://example.com/visible.png", alt: "Visible" }]);
});
