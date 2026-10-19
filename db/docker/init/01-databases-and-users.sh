#!/bin/bash
# First-start initialization of the local Docker database (db/README.md §1, §3).
# Passwords come from the container environment (docker-compose.yml → .env),
# so no secret is stored in the repository.
set -euo pipefail

# Escape single quotes for use inside SQL string literals.
sql_quote() {
  printf '%s' "$1" | sed "s/'/''/g"
}

APP_PW="$(sql_quote "$QA_APP_PASSWORD")"
MIGRATOR_PW="$(sql_quote "$QA_MIGRATOR_PASSWORD")"

mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS api_to_do_qa
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS api_to_do_qa_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Runtime user: data only (design §5.6).
CREATE USER IF NOT EXISTS 'qa_app'@'%' IDENTIFIED BY '${APP_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE ON api_to_do_qa.* TO 'qa_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON api_to_do_qa_test.* TO 'qa_app'@'%';

-- Migration user: also schema changes. DROP only on the test database,
-- where the integration tests drop and re-create the auth tables.
CREATE USER IF NOT EXISTS 'qa_migrator'@'%' IDENTIFIED BY '${MIGRATOR_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON api_to_do_qa.* TO 'qa_migrator'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES
  ON api_to_do_qa_test.* TO 'qa_migrator'@'%';
SQL
