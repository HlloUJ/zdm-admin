CREATE TABLE auth_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  account_id BIGINT NOT NULL,
  identity_id BIGINT NOT NULL,
  client_code VARCHAR(40) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  last_used_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_auth_sessions_token_hash (token_hash),
  KEY idx_auth_sessions_account_client (account_id, client_code),
  KEY idx_auth_sessions_identity (identity_id),
  KEY idx_auth_sessions_expires_at (expires_at),
  CONSTRAINT fk_auth_sessions_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_auth_sessions_identity FOREIGN KEY (identity_id) REFERENCES account_identities (id),
  CONSTRAINT fk_auth_sessions_client FOREIGN KEY (client_code) REFERENCES platform_clients (code)
);

CREATE TABLE security_audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_id BIGINT,
  identity_id BIGINT,
  client_code VARCHAR(40),
  request_method VARCHAR(10) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  result_status INT NOT NULL,
  result VARCHAR(20) NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_security_audit_account_time (account_id, occurred_at),
  KEY idx_security_audit_identity_time (identity_id, occurred_at),
  KEY idx_security_audit_path_time (request_path, occurred_at)
);
