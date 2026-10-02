-- Validate the rules (writes continue while this runs), then tighten the column.
ALTER TABLE patients VALIDATE CONSTRAINT patients_email_present;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_patient_fk;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_start_check;
ALTER TABLE patients ALTER COLUMN email SET NOT NULL;

-- Expand and contract: the new column goes in beside the old one. Dropping the old
-- column, the old table and the rename wait for a later release.
ALTER TABLE appointments ADD COLUMN start_time timestamptz;

UPDATE appointments SET start_time = starts_at WHERE start_time IS NULL;
DELETE FROM reminders WHERE sent_at IS NULL;
UPDATE patients SET active = true WHERE active IS NULL;

LOCK TABLE rooms IN SHARE ROW EXCLUSIVE MODE;
VACUUM (ANALYZE) appointments;
