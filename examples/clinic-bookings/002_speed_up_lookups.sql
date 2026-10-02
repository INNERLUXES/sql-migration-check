-- Speed up the calendar and the patient view.
BEGIN;
CREATE INDEX appointments_starts_at_idx ON appointments (starts_at);
CREATE INDEX CONCURRENTLY appointments_patient_idx ON appointments (patient_id);
COMMIT;
