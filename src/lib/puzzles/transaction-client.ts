import { Prisma } from "@prisma/client";

/**
 * The transaction client handed to a `$transaction(async (tx) => …)` callback.
 *
 * Uses the `Prisma.TransactionClient` export emitted by the generated client
 * (`Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>`) rather than
 * deriving it via `Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]`.
 * The export was previously unavailable in early v7 but is present again in
 * 7.8.0+. The inference-based derivation resolved fine under standalone `tsc`
 * but collapsed to `never` under the Next.js build type-checker (Turbopack
 * worker), failing the Vercel build with "Argument of type 'any' is not
 * assignable to parameter of type 'never'" at every PrismaTransaction call
 * site. The direct export is a plain alias with no inference, so it resolves
 * identically under both checkers. A full `PrismaClient` still satisfies it,
 * so call sites may pass `db` or a `tx`.
 */
export type PrismaTransaction = Prisma.TransactionClient;
