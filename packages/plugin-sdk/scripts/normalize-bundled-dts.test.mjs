import { describe, expect, it } from "vitest";

import { normalizeBundledDts } from "./normalize-bundled-dts.mjs";

describe("normalizeBundledDts", () => {
  it("sorts inferred Zod enum maps without reordering other type members", () => {
    const input = `declare const schema: z.ZodObject<{
    second: z.ZodEnum<{
        zebra: "zebra";
        "accept-edits": "accept-edits";
        auto: "auto";
    }>;
    first: z.ZodString;
}>;
type Unrelated = {
    zebra: string;
    alpha: string;
};
`;

    expect(normalizeBundledDts(input)).toBe(`declare const schema: z.ZodObject<{
    second: z.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        zebra: "zebra";
    }>;
    first: z.ZodString;
}>;
type Unrelated = {
    zebra: string;
    alpha: string;
};
`);
  });

  it("normalizes equivalent enum maps and quoted literal unions identically", () => {
    const first = `type Choice = "zebra" | "alpha";
declare const schema: z$1.ZodEnum<{
    zebra: "zebra";
    alpha: "alpha";
}>;
`;
    const second = `type Choice = "alpha" | "zebra";
declare const schema: z$1.ZodEnum<{
    alpha: "alpha";
    zebra: "zebra";
}>;
`;

    const normalized = normalizeBundledDts(first);
    expect(normalized).toBe(normalizeBundledDts(second));
    expect(normalizeBundledDts(normalized)).toBe(normalized);
  });
});
