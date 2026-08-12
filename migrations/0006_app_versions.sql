-- S-002: アプリごとのバージョン・配布・アプリ単位メンテナンス情報を管理します。
-- ライセンス認証サーバー全体の maintenance_mode / maintenance_message は
-- 従来どおり settings に残し、本テーブルの値とは別の責務で扱います。
CREATE TABLE IF NOT EXISTS app_versions (
  app_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'release'
    CHECK (
      length(channel) > 0
      AND channel = lower(channel)
      AND channel NOT GLOB '*[^a-z0-9_-]*'
    ),
  latest_version TEXT NOT NULL DEFAULT '0.0.0'
    CHECK (length(trim(latest_version)) > 0),
  minimum_version TEXT NOT NULL DEFAULT '0.0.0'
    CHECK (length(trim(minimum_version)) > 0),
  download_url TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  maintenance_mode INTEGER NOT NULL DEFAULT 0
    CHECK (maintenance_mode IN (0, 1)),
  maintenance_message TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (app_id, channel),
  FOREIGN KEY (app_id) REFERENCES applications(app_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_versions_channel_updated_at
ON app_versions(channel, updated_at DESC);
