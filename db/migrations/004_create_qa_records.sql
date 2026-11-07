-- 004: qa_records (PLAN F1 / SPEC "Guardado de QA y vista QA Shadow").
-- One row per saved QA, keyed by Task ID (UNIQUE): a second "Guardar QA"
-- with the same Task ID is rejected ("no se puede guardar otro encima").
-- Conventions from 001: id CHAR(36) ascii, DATETIME(3) in UTC set by the
-- app (no engine defaults), utf8mb4_unicode_ci. created_at is indexed for
-- the month view (F3, month cut in Bolivia time D13) and the monthly purge
-- (F8, day 10 D4).
--
-- summary (D3) and checklist (D19) are JSON columns: MariaDB stores JSON as
-- LONGTEXT with CHECK (JSON_VALID(...)), compatible with MySQL 8. The
-- summary holds the run's checks; its findings carry their BUGS.md bug id
-- (F0), so automatic and manual findings share one table of criteria. The
-- checklist maps each manual item to passed / bug / n/a.
--
-- critical_count, failed_count and opportunity_count (D21) are stored per
-- record so the final status text ("Critical (1), Failed (2), ..." or
-- "Passed") is built from them when the QA is closed (F5). The review fields
-- stay NULL until then: reviewer_id is who took the QA (D10), qa_status and
-- qa_comment are what the QA Shadow closes it with (D8). No QA Link (D2).
CREATE TABLE qa_records (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id           VARCHAR(50) NOT NULL,
  owner_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  page_url          VARCHAR(2048) NOT NULL,
  note_for_shadow   TEXT NULL,
  summary           JSON NOT NULL,
  checklist         JSON NULL,
  critical_count    INT NOT NULL DEFAULT 0,
  failed_count      INT NOT NULL DEFAULT 0,
  opportunity_count INT NOT NULL DEFAULT 0,
  reviewer_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  qa_comment        TEXT NULL,
  qa_status         VARCHAR(255) NULL,
  closed_at         DATETIME(3) NULL,
  closed_by         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at        DATETIME(3) NOT NULL,
  updated_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY qa_records_task_id_uq (task_id),
  KEY qa_records_created_at_idx (created_at),
  CONSTRAINT qa_records_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT qa_records_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT qa_records_closed_by_fk FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
