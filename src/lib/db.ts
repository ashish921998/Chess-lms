import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Load .env in non-Next.js contexts (seed scripts, tests). Next.js loads it via @next/env.
if (process.env.DATABASE_URL === undefined) {
  import("dotenv/config");
}

const globalForPrisma = globalThis as unknown as {
  prismaPool?: Pool;
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const pool =
    globalForPrisma.prismaPool ??
    new Pool({ connectionString: process.env.DATABASE_URL });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prismaPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
