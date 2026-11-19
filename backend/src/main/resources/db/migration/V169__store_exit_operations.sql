CREATE TABLE store_exit_operations (
  operation_id VARCHAR(36) PRIMARY KEY,
  store_id BIGINT NOT NULL,
  tenant_id BIGINT NOT NULL,
  store_name VARCHAR(200) NOT NULL,
  tenant_name VARCHAR(200) NOT NULL,
  operator_account_id BIGINT NULL,
  operator_name VARCHAR(200) NOT NULL,
  operator_identity VARCHAR(200) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  plan_hash CHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_store_exit_target(store_id),
  KEY idx_store_exit_tenant(tenant_id)
);

CREATE TABLE store_exit_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  operation_id VARCHAR(36) NOT NULL,
  store_id BIGINT NOT NULL,
  tenant_id BIGINT NULL,
  operator_account_id BIGINT NULL,
  result VARCHAR(30) NOT NULL,
  reason_code VARCHAR(100) NOT NULL,
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_store_exit_event_operation(operation_id)
);

CREATE TABLE store_exit_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  operation_id VARCHAR(36) NOT NULL,
  media_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_error_code VARCHAR(100) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_store_exit_task_media(operation_id, media_id)
);
