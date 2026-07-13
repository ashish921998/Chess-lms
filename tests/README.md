# Tests

Vitest. Two flavors:

- **Unit tests** (`*.test.ts`) — pure functions, no DB. Fast; run by default on `pnpm test`.
- **DB integration tests** (`*.db.test.ts`) — run against a real Postgres
  (`chess_test`), each test isolated by a transaction that always rolls back.

## Setup (one-time)

1. Start Postgres: `pnpm db:up`
2. Push the schema to the test DB (Prisma does **not** auto-migrate `chess_test`;
   migrations target the dev DB only):

   ```sh
   source .env
   pnpm exec prisma db push --skip-generate --accept-data-loss \
     --schema prisma/schema.prisma
   # run against the TEST db by pointing DATABASE_URL at it for one command:
   DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma db push --skip-generate
   ```

   Re-run that second command whenever `prisma/schema.prisma` changes.

3. Confirm: `pnpm test`.

## How DB isolation works

`withRollbackTx(fn)` (in `db-harness.ts`) wraps the test body in a Prisma
interactive `$transaction` that always rolls back. The body receives the
transaction client (`tx`); pass it into the `*Tx` form of the code under test.

This is why M3 extracts `finalizeSolvedTx(tx, …)` instead of only exposing the
`db.$transaction(...)` wrapper: the wrapper would commit outside the rollback
scope and tests would leak state across each other.

**Known limitation:** true parallel-race tests (two concurrent connections
landing writes at the same row) can't be reproduced inside a single rollback
transaction — those invariants are instead asserted sequentially and by the
algebra of the SQL (e.g. `LEAST(progress + 1, targetCount)` cannot overshoot).
