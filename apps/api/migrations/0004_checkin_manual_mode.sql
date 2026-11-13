ALTER TABLE checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_scan_mode_check;
ALTER TABLE checkin_logs ADD CONSTRAINT checkin_logs_scan_mode_check CHECK (scan_mode IN ('hid', 'webcam', 'manual'));
