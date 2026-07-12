-- Row-level triggers do not fire on TRUNCATE, which could otherwise erase the
-- entire evidence table in one statement. Block TRUNCATE too, so the audit trail
-- truly cannot be rewritten by any ad-hoc SQL. (A superuser doing controlled
-- fixture resets bypasses this via session_replication_role = 'replica'.)
CREATE OR REPLACE FUNCTION reject_record_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inspection_records are immutable: TRUNCATE is not permitted'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inspection_records_no_truncate
  BEFORE TRUNCATE ON inspection_records
  FOR EACH STATEMENT EXECUTE FUNCTION reject_record_truncate();
