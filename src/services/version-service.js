import { AppVersionRepository } from "../repositories/app-version-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { jsonResponse } from "../utils/http.js";

const LEGACY_APP_ID = "voicon";
const LEGACY_CHANNEL = "release";

export async function getVersionInfo(env) {
  if (!env.DB) {
    return jsonResponse({
      success: false,
      errorCode: "SERVER_CONFIGURATION_ERROR",
      message: "サーバー設定が完了していません。"
    }, 500);
  }

  // 旧Voiconクライアントとのレスポンス互換を維持しながら、
  // 更新情報の参照元を app_versions に一本化します。
  const row = await new AppVersionRepository(env.DB)
    .findActiveByAppIdAndChannel(LEGACY_APP_ID, LEGACY_CHANNEL);

  if (row) {
    return jsonResponse({
      success: true,
      latestVersion: row.latest_version,
      minimumVersion: row.minimum_version,
      downloadUrl: row.download_url,
      releaseNotes: row.release_notes,
      maintenanceMode: Number(row.maintenance_mode) === 1,
      maintenanceMessage: row.maintenance_message,
      message: null
    });
  }

  // マイグレーション未適用環境でも旧APIを停止させないための暫定フォールバックです。
  // app_versions にVoiconデータが作成された後は、この経路は使用されません。
  const settings = await new SettingsRepository(env.DB).getLegacyVersionSettings();
  return jsonResponse({
    success: true,
    latestVersion: settings.latestVersion,
    minimumVersion: settings.minimumVersion,
    downloadUrl: settings.downloadUrl,
    releaseNotes: settings.releaseNotes,
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage,
    message: null
  });
}
