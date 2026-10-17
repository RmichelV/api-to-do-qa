-- 002: user_sessions (design §4.2).
-- Only SHA-256 hashes of cookie tokens are stored, never the tokens.
CREATE TABLE user_sessions (
  id                  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash          BINARY(32) NOT NULL,
  previous_token_hash BINARY(32) NULL,
  rotated_at          DATETIME(3) NOT NULL,
  created_at          DATETIME(3) NOT NULL,
  last_seen_at        DATETIME(3) NOT NULL,
  expires_at          DATETIME(3) NOT NULL,
  revoked_at          DATETIME(3) NULL,
  user_agent          VARCHAR(255) NULL,
  ip_address          VARCHAR(45) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_sessions_token_uq (token_hash),
  KEY user_sessions_prev_token_idx (previous_token_hash),
  KEY user_sessions_user_idx (user_id),
  KEY user_sessions_expires_idx (expires_at),
  CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
