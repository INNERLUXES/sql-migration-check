-- Patient contact details and integrity rules.
ALTER TABLE patients ADD COLUMN phone text NOT NULL;
ALTER TABLE patients ADD COLUMN created_at timestamptz DEFAULT clock_timestamp();
ALTER TABLE patients ALTER COLUMN date_of_birth TYPE timestamp;
ALTER TABLE patients ALTER COLUMN email SET NOT NULL;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_patient_fk FOREIGN KEY (patient_id) REFERENCES patients (id);
ALTER TABLE appointments
  ADD CONSTRAINT appointments_start_check CHECK (starts_at IS NOT NULL);
