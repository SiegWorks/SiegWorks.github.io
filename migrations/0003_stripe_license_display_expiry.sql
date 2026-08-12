-- These columns were added manually in Cloudflare D1 during development.
-- Run only the statements that have not already been applied.
ALTER TABLE stripe_orders ADD COLUMN license_key_iv TEXT;
ALTER TABLE stripe_orders ADD COLUMN license_key_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_stripe_orders_license_id
ON stripe_orders(license_id);

CREATE INDEX IF NOT EXISTS idx_stripe_events_status
ON stripe_events(processing_status);
