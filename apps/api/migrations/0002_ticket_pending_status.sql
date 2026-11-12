-- 0002_ticket_pending_status.sql: Allow 'pending' status on tickets for unpaid orders

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('pending', 'valid', 'cancelled'));
