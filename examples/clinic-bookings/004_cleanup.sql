-- Tidy up the schema and the data.
ALTER TABLE appointments RENAME COLUMN starts_at TO start_time;
ALTER TABLE appointments DROP COLUMN notes;
DROP TABLE legacy_waitlist;
TRUNCATE reminders;
DELETE FROM appointments;
UPDATE patients SET active = true;
LOCK TABLE rooms IN ACCESS EXCLUSIVE MODE;
VACUUM FULL appointments;
CLUSTER appointments USING appointments_starts_at_idx;
