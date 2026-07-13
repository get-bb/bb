# Connect DB migration metadata

Migrations 0000–0003 predate this package's Drizzle Kit workflow and remain the
deployed SQL source of truth. Their journal positions were bootstrapped with
Drizzle custom migrations, and 0003 is the generated full-schema baseline.
Migration 0004 and later use the normal schema-diff workflow and generated
snapshots.

From this package, generate the next migration with:

```sh
pnpm db:generate --name <migration_name>
```

Never edit snapshot JSON by hand.
