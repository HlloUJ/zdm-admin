CREATE TABLE store_payment_names (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 tenant_id BIGINT NOT NULL,
 store_id BIGINT NOT NULL,
 name VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 version BIGINT NOT NULL DEFAULT 1,
 created_by_account_id BIGINT NULL,
 updated_by_account_id BIGINT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 deleted_at DATETIME(3) NULL,
 deleted_by_account_id BIGINT NULL,
 live_name VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin
  GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN name ELSE NULL END) STORED,
 UNIQUE KEY uq_payment_name_live (tenant_id, store_id, live_name),
 KEY idx_payment_name_list (tenant_id, store_id, deleted_at, created_at, id),
 KEY idx_payment_name_options (tenant_id, store_id, deleted_at, enabled),
 CONSTRAINT chk_payment_name_not_blank CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 10)
);
CREATE TABLE store_payment_name_events (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 tenant_id BIGINT NOT NULL,
 store_id BIGINT NOT NULL,
 payment_name_id BIGINT NOT NULL,
 action VARCHAR(20) NOT NULL,
 operator_account_id BIGINT NULL,
 operator_name VARCHAR(100) NOT NULL,
 before_value JSON NULL,
 after_value JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_payment_name_events (tenant_id, store_id, payment_name_id, id),
 CONSTRAINT fk_payment_name_event_record FOREIGN KEY (payment_name_id) REFERENCES store_payment_names(id)
);
