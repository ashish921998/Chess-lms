// Vitest global setup: load .env so TEST_DATABASE_URL (and DATABASE_URL) are
// available to the DB harness without requiring callers to `source .env`.
// Mirrors what Next.js (@next/env) does for the app.
import "dotenv/config";
