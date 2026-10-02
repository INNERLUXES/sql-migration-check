-- Check the rules that were added earlier, and seed a reminder.
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_patient_fk;

DO $$
BEGIN
  DELETE FROM reminders WHERE sent_at IS NULL;
END
$$;

INSERT INTO reminders (appointment_id) VALUES (1)
