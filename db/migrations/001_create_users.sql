-- 001: users (design §4.1).
-- UUIDs and hashes use ascii so the bytes are portable; timestamps are
-- DATETIME(3) in UTC, set explicitly by the app (no engine defaults).
CREATE TABLE users (
  id                   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email                VARCHAR(254) NOT NULL,
  full_name            VARCHAR(120) NOT NULL,
  role                 ENUM('admin', 'qa_engineer') NOT NULL,
  password_hash        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  password_changed_at  DATETIME(3) NOT NULL,
  last_login_at        DATETIME(3) NULL,
  created_by           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at           DATETIME(3) NOT NULL,
  updated_at           DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_uq (email),
  CONSTRAINT users_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
