import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment.`);
  }
  return value;
}
