import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // `prisma generate` only reads the schema — it never connects — so it must
    // not crash when DATABASE_URL is absent (e.g. during a fresh `pnpm install`
    // / Vercel install step before build env is wired). Real commands (migrate,
    // db push, the running app) get the actual URL from the environment.
    url: env("DATABASE_URL") ?? "postgresql://generate-only@localhost:5432/generate",
  },
});

function env(name: string): string | undefined {
  return process.env[name];
}
