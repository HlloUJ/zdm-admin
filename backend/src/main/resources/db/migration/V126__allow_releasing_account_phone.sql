-- No historical accounts are cleaned up by this migration.
-- Null means the old account is retained for history but no longer owns a phone credential.
ALTER TABLE accounts MODIFY COLUMN phone VARCHAR(20) NULL;
