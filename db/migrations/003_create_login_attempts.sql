-- 003: login_attempts (design §4.3).
-- Brute-force log that survives restarts and multiple instances; rows older
-- than 24 h are purged opportunistically on login (T5).
CREATE TABLE login_attempts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email        VARCHAR(254) NOT NULL,
  ip_address   VARCHAR(45) NOT NULL,
  succeeded    TINYINT(1) NOT NULL,
  attempted_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY login_attempts_email_time_idx (email, attempted_at),
  KEY login_attempts_ip_time_idx (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
