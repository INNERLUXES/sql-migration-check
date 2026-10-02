-- Clinic bookings, first migration. It has already run everywhere, so the check
-- reads it only to learn which tables exist (--since 002_speed_up_lookups.sql).

CREATE TABLE patients (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name text NOT NULL,
  email text,
  date_of_birth date,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE rooms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE appointments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id bigint NOT NULL,
  room_id bigint NOT NULL,
  starts_at timestamptz NOT NULL,
  notes text
);

CREATE TABLE reminders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id bigint NOT NULL,
  sent_at timestamptz
);

CREATE TABLE legacy_waitlist (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id bigint,
  note text
);

INSERT INTO rooms (name) VALUES ('Room A'), ('Room B');
