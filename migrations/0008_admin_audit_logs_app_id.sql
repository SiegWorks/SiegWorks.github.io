ALTER TABLE admin_audit_logs ADD COLUMN app_id TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_app_id
  ON admin_audit_logs(app_id);
