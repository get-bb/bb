import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/pg-schema.ts",
  out: "./migrations-pg",
  dialect: "postgresql",
});
