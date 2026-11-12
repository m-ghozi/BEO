-- 0003_ledger_nullable_event_id.sql: Allow NULL event_id on ledger_entries for organizer-level payout_debit entries

ALTER TABLE ledger_entries ALTER COLUMN event_id DROP NOT NULL;
