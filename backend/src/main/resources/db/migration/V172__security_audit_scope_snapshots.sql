-- Snapshots remain independent of live identities and organizations. No historical scope is guessed.
ALTER TABLE security_audit_logs
  ADD COLUMN actor_name_snapshot VARCHAR(200) NULL,
  ADD COLUMN identity_type_snapshot VARCHAR(50) NULL,
  ADD COLUMN tenant_id_snapshot BIGINT NULL,
  ADD COLUMN tenant_name_snapshot VARCHAR(200) NULL,
  ADD COLUMN store_id_snapshot BIGINT NULL,
  ADD COLUMN store_name_snapshot VARCHAR(200) NULL,
  ADD COLUMN scope_snapshot_source VARCHAR(30) NULL,
  ADD COLUMN scope_snapshot_at DATETIME(6) NULL,
  ADD KEY idx_security_audit_store_snapshot_time (store_id_snapshot,occurred_at);
