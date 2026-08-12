-- S-001: 配布対象アプリを管理する共通テーブルを追加します。
-- app_id は API・各クライアント・管理ツールで共通使用する不変の内部識別子です。
CREATE TABLE IF NOT EXISTS applications (
  app_id TEXT PRIMARY KEY
    CHECK (
      length(app_id) > 0
      AND app_id = lower(app_id)
      AND app_id NOT GLOB '*[^a-z0-9_]*'
    ),
  display_name TEXT NOT NULL
    CHECK (length(trim(display_name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO applications (app_id, display_name, is_active)
VALUES
  ('voicon', 'Voicon', 1),
  ('dcs_localizer', 'DCS Localizer', 1)
ON CONFLICT(app_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_applications_active_display_name
ON applications(is_active, display_name);
