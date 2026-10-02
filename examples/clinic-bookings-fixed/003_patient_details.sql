-- Patient contact details and integrity rules: expand first, tighten later.
ALTER TABLE patients ADD COLUMN phone text;
ALTER TABLE patients ADD COLUMN created_at timestamptz;
ALTER TABLE patients ALTER COLUMN created_at SET DEFAULT now();

-- The rules go in without scanning the tables; the next migration validates them.
ALTER TABLE patients
  ADD CONSTRAINT patients_email_present CHECK (email IS NOT NULL) NOT VALID;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_patient_fk FOREIGN KEY (patient_id) REFERENCES patients (id) NOT VALID;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_start_check CHECK (starts_at IS NOT NULL) NOT VALID;
