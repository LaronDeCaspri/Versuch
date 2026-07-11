-- Inspection records are immutable evidence: no UPDATE, no DELETE, ever.
-- Enforced in the database so no application code path — or ad-hoc SQL — can
-- quietly rewrite the audit trail. Corrections happen by inserting a new record
-- whose supersedesId points at the mistaken one.
CREATE OR REPLACE FUNCTION reject_record_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inspection_records are immutable: % is not permitted (id=%)',
    TG_OP, COALESCE(OLD.id, NEW.id)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inspection_records_no_update
  BEFORE UPDATE ON inspection_records
  FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();

CREATE TRIGGER inspection_records_no_delete
  BEFORE DELETE ON inspection_records
  FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();

-- A statutory duty may be deactivated (active = false, with a written reason)
-- but never hard-deleted — silent deletion of a statutory duty is exactly the
-- audit hole this system exists to close.
CREATE OR REPLACE FUNCTION reject_statutory_duty_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."isStatutory" THEN
    RAISE EXCEPTION 'statutory asset_duties cannot be deleted (id=%); deactivate with a reason instead',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_duties_no_statutory_delete
  BEFORE DELETE ON asset_duties
  FOR EACH ROW EXECUTE FUNCTION reject_statutory_duty_delete();
