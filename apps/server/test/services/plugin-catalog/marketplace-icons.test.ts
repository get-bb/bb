import { describe, expect, it } from "vitest";
import { marketplaceIconContentType } from "../../../src/services/plugin-catalog/marketplace-icons.js";

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>',
);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.alloc(8),
]);

const base = "https://cdn.example/icons/widgets";

describe("marketplace icon validation", () => {
  it("accepts each declared format", () => {
    expect(marketplaceIconContentType(`${base}.svg`, SVG)).toBe(
      "image/svg+xml",
    );
    expect(marketplaceIconContentType(`${base}.png`, PNG)).toBe("image/png");
    expect(marketplaceIconContentType(`${base}.webp`, WEBP)).toBe("image/webp");
  });

  it("refuses bytes that do not match the declared format", () => {
    expect(() => marketplaceIconContentType(`${base}.png`, WEBP)).toThrow(
      "icon is not a PNG file",
    );
    expect(() => marketplaceIconContentType(`${base}.webp`, PNG)).toThrow(
      "icon is not a WebP file",
    );
    expect(() => marketplaceIconContentType(`${base}.svg`, PNG)).toThrow();
  });

  it("runs SVG bytes through the plugin icon sanitizer", () => {
    expect(() =>
      marketplaceIconContentType(
        `${base}.svg`,
        Buffer.from(
          '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>',
        ),
      ),
    ).toThrow(/doctype/);
    expect(() =>
      marketplaceIconContentType(
        `${base}.svg`,
        Buffer.from("<html><body>nope</body></html>"),
      ),
    ).toThrow(/<svg> root element/);
  });

  it("refuses an icon over the size cap", () => {
    expect(() =>
      marketplaceIconContentType(`${base}.png`, Buffer.alloc(300 * 1024)),
    ).toThrow(/exceeds 262144 bytes/);
  });

  it("refuses a URL with an unsupported extension", () => {
    expect(() => marketplaceIconContentType(`${base}.gif`, PNG)).toThrow(
      /must be a \.svg, \.png, or \.webp file/,
    );
  });
});
