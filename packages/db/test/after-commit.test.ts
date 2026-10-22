import { afterEach, describe, expect, it } from "vitest";
import { afterCommit, claimInstallTurnNumber } from "../src/index.js";
import { createMigratedConnection } from "../src/testing.js";

const connections: ReturnType<typeof createMigratedConnection>[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
});

describe("committed turn numbers", () => {
  it("discards rolled-back savepoints and keeps committed callbacks in order", () => {
    const db = createMigratedConnection();
    connections.push(db);
    const numbers: number[] = [];
    db.transaction((tx) => {
      afterCommit(tx, () => numbers.push(claimInstallTurnNumber(db, 1)));
      expect(() =>
        tx.transaction((nested) => {
          afterCommit(nested, () => numbers.push(999));
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      tx.transaction((nested) => {
        afterCommit(nested, () => numbers.push(claimInstallTurnNumber(db, 2)));
      });
      expect(numbers).toEqual([]);
    });
    expect(numbers).toEqual([1, 2]);
  });
});
