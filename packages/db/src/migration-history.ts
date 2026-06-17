export interface PublishedMigrationWhen {
  tag: string;
  when: number;
}

export interface CompatibleMigrationHash {
  hash: string;
  tag: string;
  when: number;
}

export const publishedMigrationWhens = [
  { tag: "0000_baseline", when: 1778891867195 },
  { tag: "0001_terminal_session_user_input", when: 1779139400000 },
  { tag: "0002_closed_session_prune_indexes", when: 1779139400001 },
] as const satisfies readonly PublishedMigrationWhen[];

export const compatibleMigrationHashes = [
  {
    tag: "0031_mysterious_zaran",
    when: 1781403656069,
    hash: "bc111f5134183c37cf135af70231ec5a79823f9868818fdd8377e1ab3c05a23f",
  },
] as const satisfies readonly CompatibleMigrationHash[];

export const publishedMigrationWhensByTag: ReadonlyMap<string, number> =
  new Map(publishedMigrationWhens.map((entry) => [entry.tag, entry.when]));
