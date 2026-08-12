-- S-005: settings に保存されている既存Voicon更新情報を
-- app_versions(app_id='voicon', channel='release') へ一度だけ移行します。
-- 移行後も settings の旧項目は互換期間中のため削除しません。
-- 既に新テーブル側にデータがある場合は上書きしません。

INSERT INTO app_versions (
  app_id,
  channel,
  latest_version,
  minimum_version,
  download_url,
  release_notes,
  maintenance_mode,
  maintenance_message,
  published_at,
  updated_at
)
SELECT
  'voicon',
  'release',
  COALESCE(
    NULLIF(TRIM((SELECT setting_value FROM settings WHERE setting_key = 'latest_version')), ''),
    '0.0.0'
  ),
  COALESCE(
    NULLIF(TRIM((SELECT setting_value FROM settings WHERE setting_key = 'minimum_version')), ''),
    '0.0.0'
  ),
  COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'download_url'), ''),
  COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'release_notes'), ''),
  CASE
    WHEN LOWER(TRIM(COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'maintenance_mode'), 'false')))
      IN ('1', 'true', 'yes', 'on') THEN 1
    ELSE 0
  END,
  COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'maintenance_message'), ''),
  (
    SELECT MAX(updated_at)
    FROM settings
    WHERE setting_key IN (
      'latest_version',
      'minimum_version',
      'download_url',
      'release_notes',
      'maintenance_mode',
      'maintenance_message'
    )
  ),
  COALESCE(
    (
      SELECT MAX(updated_at)
      FROM settings
      WHERE setting_key IN (
        'latest_version',
        'minimum_version',
        'download_url',
        'release_notes',
        'maintenance_mode',
        'maintenance_message'
      )
    ),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
WHERE EXISTS (
  SELECT 1
  FROM settings
  WHERE setting_key IN (
    'latest_version',
    'minimum_version',
    'download_url',
    'release_notes',
    'maintenance_mode',
    'maintenance_message'
  )
)
ON CONFLICT(app_id, channel) DO NOTHING;
