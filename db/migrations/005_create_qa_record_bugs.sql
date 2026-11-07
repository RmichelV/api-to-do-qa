-- 005: qa_record_bugs (PLAN F1, D20).
-- One row per found bug, automatic or manual: bug_id is its BUGS.md id
-- (OPP-01, FAIL-06, CRIT-01...), and device / type / severity / description
-- are exactly the four fields of one generated comment line,
-- `Device / Type / Severity / Description` (D20; device is M, D or M/D per
-- D21). The auto-increment id preserves the reported order, which is the
-- order of the comment lines. description is capped at 200 characters, the
-- same cap as the summary texts (D3). `type` is VARCHAR (not an ENUM) so a
-- new category in BUGS.md never needs a schema change.
--
-- source (D9): 'tool' rows are what the tool found when the QA was saved and
-- are kept; 'manual' rows are what a QA Shadow marks during its review, and
-- those are the only ones deleted with the review when the Admin removes the
-- role from a Shadow whose review was never closed (the tool's findings
-- survive, and closed reviews are never touched).
--
-- ON DELETE CASCADE: the rows only exist to describe their record, so the
-- monthly purge (F8) deletes a whole month with a single DELETE on
-- qa_records (D4). Production applies this file as qa_migrator, which is
-- allowed to CREATE and ALTER here but never to remove existing objects.
CREATE TABLE qa_record_bugs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  record_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bug_id      VARCHAR(20) NOT NULL,
  source      ENUM('tool', 'manual') NOT NULL,
  device      ENUM('M', 'D', 'M/D') NOT NULL,
  type        VARCHAR(30) NOT NULL,
  severity    ENUM('Opportunity', 'Failed', 'Critical') NOT NULL,
  description VARCHAR(200) NOT NULL,
  PRIMARY KEY (id),
  KEY qa_record_bugs_record_idx (record_id),
  CONSTRAINT qa_record_bugs_record_fk FOREIGN KEY (record_id) REFERENCES qa_records (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
