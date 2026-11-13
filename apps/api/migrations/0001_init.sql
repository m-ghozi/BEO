-- 0001_init.sql: Initial schema for BEO

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('standard', 'agency', 'platform_admin')),
    expo_push_tokens TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. category_commission_rates
CREATE TABLE IF NOT EXISTS category_commission_rates (
    event_category TEXT PRIMARY KEY,
    commission_percent NUMERIC(5,2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. events
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('community', 'seminar_workshop', 'conference', 'meetup_ted')),
    modules_enabled JSONB NOT NULL DEFAULT '{}'::jsonb,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    venue TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. event_members
CREATE TABLE IF NOT EXISTS event_members (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('co_organizer', 'reviewer', 'checkin_staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, user_id, role)
);

-- 5. event_sessions
CREATE TABLE IF NOT EXISTS event_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    speaker_name TEXT NOT NULL DEFAULT '',
    speaker_bio TEXT NOT NULL DEFAULT '',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    room_or_stage TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ticket_types
CREATE TABLE IF NOT EXISTS ticket_types (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'IDR',
    quota INT NOT NULL DEFAULT 0,
    allocated_agency_quota INT NOT NULL DEFAULT 0,
    sold_count INT NOT NULL DEFAULT 0,
    reserved_count INT NOT NULL DEFAULT 0,
    requires_accepted_cfp BOOLEAN NOT NULL DEFAULT FALSE,
    sales_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sales_end_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. event_agencies
CREATE TABLE IF NOT EXISTS event_agencies (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    agency_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
    quota_limit INT NOT NULL DEFAULT 0,
    issued_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, agency_user_id, ticket_type_id)
);

-- 8. orders
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    agency_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    buyer_email TEXT NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('free', 'duitku', 'manual_transfer', 'agency_issued')),
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'pending_verification', 'paid', 'expired', 'rejected')),
    duitku_reference TEXT,
    proof_file_url TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. tickets
CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
    ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    agency_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    attendee_name TEXT NOT NULL DEFAULT '',
    attendee_email TEXT NOT NULL DEFAULT '',
    ticket_code TEXT UNIQUE NOT NULL,
    qr_signature TEXT NOT NULL,
    claim_token TEXT UNIQUE,
    claimed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled')),
    checked_in_at TIMESTAMPTZ,
    checked_in_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. ledger_entries
CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('ticket_sale_gross', 'platform_commission', 'payout_debit')),
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. payout_requests
CREATE TABLE IF NOT EXISTS payout_requests (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    bank_name TEXT NOT NULL,
    bank_account_number TEXT NOT NULL,
    bank_account_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. checkin_logs
CREATE TABLE IF NOT EXISTS checkin_logs (
    id TEXT PRIMARY KEY,
    ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    scanner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    scan_mode TEXT NOT NULL CHECK (scan_mode IN ('hid', 'webcam')),
    result TEXT NOT NULL CHECK (result IN ('success', 'duplicate', 'invalid')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. cfp_submissions
CREATE TABLE IF NOT EXISTS cfp_submissions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    abstract TEXT NOT NULL DEFAULT '',
    file_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'revision_required', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. cfp_reviews
CREATE TABLE IF NOT EXISTS cfp_reviews (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES cfp_submissions(id) ON DELETE CASCADE,
    reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INT NOT NULL DEFAULT 0,
    comments TEXT NOT NULL DEFAULT '',
    recommendation TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, reviewer_user_id)
);

-- 15. event_posts
CREATE TABLE IF NOT EXISTS event_posts (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    notify_push BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. audit_events
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    event_category TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_event_members_event_user ON event_members(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_types_event_id ON ticket_types(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_code ON tickets(ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_claim_token ON tickets(claim_token);
CREATE INDEX IF NOT EXISTS idx_ledger_organizer_id ON ledger_entries(organizer_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_event_ticket ON checkin_logs(event_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_cfp_submissions_event_id ON cfp_submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_id ON audit_events(event_id);

-- Default seed rows for category_commission_rates
INSERT INTO category_commission_rates (event_category, commission_percent, updated_at)
VALUES
    ('community', 2.50, NOW()),
    ('seminar_workshop', 5.00, NOW()),
    ('conference', 5.00, NOW()),
    ('meetup_ted', 3.00, NOW())
ON CONFLICT (event_category) DO NOTHING;

