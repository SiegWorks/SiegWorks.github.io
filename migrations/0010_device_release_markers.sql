-- Records an administrator-initiated device release until the user explicitly
-- performs manual online authentication on the released device.
CREATE TABLE IF NOT EXISTS device_release_markers (
  license_id INTEGER NOT NULL,
  device_hash TEXT NOT NULL,
  released_at TEXT NOT NULL,
  released_by TEXT NOT NULL DEFAULT 'manager',
  PRIMARY KEY (license_id, device_hash),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_release_markers_license_id
  ON device_release_markers (license_id);
