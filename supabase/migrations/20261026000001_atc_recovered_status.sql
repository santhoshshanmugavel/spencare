-- ATC: add 'recovered' to capture_processing_status enum
--
-- Recovered events are metadata-only records created when a notification
-- reached the CaptureOutbox but the notification content was unavailable
-- at upload time (process-death or reboot recovery). No extraction is
-- attempted; the row serves as an idempotency marker and audit record.
--
-- PostgreSQL 17: ALTER TYPE ... ADD VALUE IF NOT EXISTS is transaction-safe.

ALTER TYPE capture_processing_status ADD VALUE IF NOT EXISTS 'recovered';
