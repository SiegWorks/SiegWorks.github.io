-- S-008: settingsによるサーバー全体メンテナンス設定。
-- app_versions側はアプリ個別メンテナンス用として維持する。
INSERT INTO settings (setting_key, setting_value) VALUES ('maintenance_mode','false') ON CONFLICT(setting_key) DO NOTHING;
INSERT INTO settings (setting_key, setting_value) VALUES ('maintenance_message','現在、サーバーはメンテナンス中です。しばらくしてから再度お試しください。') ON CONFLICT(setting_key) DO NOTHING;
