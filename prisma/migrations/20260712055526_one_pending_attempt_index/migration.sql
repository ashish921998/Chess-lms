-- Partial unique index: at most one PENDING attempt per student at a time.
-- This is the issuance reservation mechanism — /next returns the existing
-- PENDING attempt rather than creating a duplicate.
CREATE UNIQUE INDEX "one_pending_attempt" ON "Attempt"("studentId") WHERE "status" = 'PENDING';
