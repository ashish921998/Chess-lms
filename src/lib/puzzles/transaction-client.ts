import { PrismaClient } from "@prisma/client";

/**
 * The transaction client handed to a `$transaction(async (tx) => …)` callback.
 * Derived from the callback signature itself (robust across Prisma versions —
 * the named `Prisma.TransactionClient` export is not emitted in v7's generated
 * client). `*Tx` functions across the app accept this type so they compose
 * inside the issuance/rollback transaction.
 */
export type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];
