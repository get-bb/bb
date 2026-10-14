import { describe, expect, it } from "vitest";
import { parseTable } from "./markdown-table";

describe("parseTable", () => {
  it("parses a GFM table from a pull request description", () => {
    const lines = [
      "## Changes",
      "| Action | Pinned SHA | Version |",
      "| --- | --- | --- |",
      "| `actions/checkout` | `11d5960a…` | v4.4.0 |",
      "| `actions/setup-node` | `49933ea5…` | v4.4.0 |",
    ];

    expect(parseTable(lines, 0)).toBeNull();
    expect(parseTable(lines, 1)).toEqual({
      alignments: [null, null, null],
      header: ["Action", "Pinned SHA", "Version"],
      rows: [
        ["`actions/checkout`", "`11d5960a…`", "v4.4.0"],
        ["`actions/setup-node`", "`49933ea5…`", "v4.4.0"],
      ],
      nextLine: 5,
    });
  });

  it("supports aligned columns and escaped pipes inside cells", () => {
    const lines = [
      "Name | Notes | Total",
      ":--- | :---: | ---:",
      "checkout | uses \\| safely | 2",
      "",
      "After the table.",
    ];

    expect(parseTable(lines, 0)).toEqual({
      alignments: ["left", "center", "right"],
      header: ["Name", "Notes", "Total"],
      rows: [["checkout", "uses | safely", "2"]],
      nextLine: 3,
    });
  });
});
