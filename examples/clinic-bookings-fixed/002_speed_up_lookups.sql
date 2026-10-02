-- Speed up the calendar and the patient view.
-- No BEGIN and no COMMIT: CREATE INDEX CONCURRENTLY cannot run in a transaction block,
-- so this file has to be run by a tool that does not wrap it in one.
CREATE INDEX CONCURRENTLY appointments_starts_at_idx ON appointments (starts_at);
CREATE INDEX CONCURRENTLY appointments_patient_idx ON appointments (patient_id);
