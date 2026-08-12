-- ライセンスエディション名を正式名称へ統一します。
-- 既存のstandard/voiconはVoiconライセンスとして移行します。
UPDATE licenses
SET edition = 'ed_voicon',
    updated_at = CURRENT_TIMESTAMP
WHERE LOWER(TRIM(edition)) IN ('standard', 'voicon');

UPDATE licenses
SET edition = 'ed_dcs_localizer',
    updated_at = CURRENT_TIMESTAMP
WHERE LOWER(TRIM(edition)) = 'dcs_localizer';

-- 同じメールアドレスでも異なるエディションを別ライセンスとして保持できるようにします。
DROP INDEX IF EXISTS idx_licenses_one_active_per_email;
DROP INDEX IF EXISTS idx_licenses_one_active_per_email_edition;

CREATE UNIQUE INDEX idx_licenses_one_active_per_email_edition
ON licenses(normalized_email, edition)
WHERE status = 'active' AND normalized_email IS NOT NULL AND TRIM(normalized_email) <> '';
