-- Defense-in-depth non-negativity backstops for the coin balances (spec §Data
-- model). The app already prevents negative balances via conditional
-- `UPDATE … WHERE coinBalance >= cost RETURNING` (spend routes). These DB-level
-- CHECKs catch a future bug that bypasses that guard. Existing rows (all ≥ 0)
-- satisfy the constraint.
ALTER TABLE "Student" ADD CONSTRAINT coin_balance_nonneg CHECK ("coinBalance" >= 0);
ALTER TABLE "Student" ADD CONSTRAINT lifetime_coins_nonneg CHECK ("lifetimeCoins" >= 0);
