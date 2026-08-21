import { describe, expect, it } from "vitest";

import { normalizeBundledDts } from "./normalize-bundled-dts.mjs";

describe("normalizeBundledDts", () => {
  it("recursively sorts inferred Zod object and enum maps", () => {
    const input = `declare const schema: z.ZodObject<{
    second: z.ZodEnum<{
        zebra: "zebra";
        "accept-edits": "accept-edits";
        auto: "auto";
    }>;
    first: z.ZodObject<{
        zebra: z.ZodString;
        alpha: z.ZodString;
    }>;
}>;
type Unrelated = {
    zebra: string;
    alpha: string;
};
`;

    expect(normalizeBundledDts(input)).toBe(`declare const schema: z.ZodObject<{
    first: z.ZodObject<{
        alpha: z.ZodString;
        zebra: z.ZodString;
    }>;
    second: z.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        zebra: "zebra";
    }>;
}>;
type Unrelated = {
    zebra: string;
    alpha: string;
};
`);
  });

  it("normalizes equivalent Zod maps and quoted literal unions identically", () => {
    const first = `type Choice = "zebra" | "alpha";
declare const objectSchema: z.ZodObject<{
    zebra: z.ZodString;
    alpha: z.ZodString;
}>;
declare const schema: z$1.ZodEnum<{
    zebra: "zebra";
    alpha: "alpha";
}>;
`;
    const second = `type Choice = "alpha" | "zebra";
declare const objectSchema: z.ZodObject<{
    alpha: z.ZodString;
    zebra: z.ZodString;
}>;
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
