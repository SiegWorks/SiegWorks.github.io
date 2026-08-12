import { AppVersionRepository } from "../repositories/app-version-repository.js";
import { createRequestId, jsonResponse } from "../utils/http.js";

const APP_ID_PATTERN = /^[a-z0-9_]+$/;
const DEFAULT_CHANNEL = "release";

export async function getAppVersionInfo(env, appIdText) {
  const requestId = createRequestId();

  if (!env.DB) {
    return jsonResponse({
      success: false,
      requestId,
      errorCode: "SERVER_CONFIGURATION_ERROR",
      message: "サーバー設定が完了していません。"
    }, 500);
  }

  const appId = typeof appIdText === "string" ? appIdText.trim() : "";
  if (!APP_ID_PATTERN.test(appId)) {
    return jsonResponse({
      success: false,
      requestId,
      errorCode: "INVALID_APP_ID",
      message: "アプリIDの形式が正しくありません。"
    }, 400);
  }

  const row = await new AppVersionRepository(env.DB)
    .findActiveByAppIdAndChannel(appId, DEFAULT_CHANNEL);

  if (!row) {
    return jsonResponse({
      success: false,
      requestId,
      errorCode: "APP_VERSION_NOT_FOUND",
      message: "指定されたアプリのバージョン情報が見つかりません。"
    }, 404);
  }

  return jsonResponse({
    appId: row.app_id,
    displayName: row.display_name,
    channel: row.channel,
    latestVersion: row.latest_version,
    minimumVersion: row.minimum_version,
    downloadUrl: row.download_url,
    releaseNotes: row.release_notes,
    maintenanceMode: Number(row.maintenance_mode) === 1,
    maintenanceMessage: row.maintenance_message,
    publishedAt: row.published_at
  });
}
