-- Freeze downstream details without changing the already-applied invalidation migration.
ALTER TABLE finished_products ADD COLUMN operations_invalidated_snapshot JSON NULL;
ALTER TABLE store_finished_products ADD COLUMN invalidated_snapshot JSON NULL;
