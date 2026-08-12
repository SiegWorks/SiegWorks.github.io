import { APP_VERSION_PATTERN } from "../config/constants.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { adminErrorResponse, adminSuccessResponse, createRequestId, getClientIp, getUserAgent, isAdminAuthorized } from "../utils/http.js";
import { compareVersions } from "../utils/version.js";

export async function getAdminVersionSettings(request, env) {
  const requestId = createRequestId();
  if (!env.ADMIN_API_KEY || !env.DB) {
    return adminErrorResponse(requestId, "SERVER_CONFIGURATION_ERROR", "サーバー設定が完了していません。", 500);
  }
  if (!isAdminAuthorized(request, env)) {
    return adminErrorResponse(requestId, "UNAUTHORIZED", "管理者認証に失敗しました。", 401);
  }
  const settings = await new SettingsRepository(env.DB).getLegacyVersionSettings();
  return adminSuccessResponse(requestId, {
    latest_version: settings.latestVersion,
    minimum_version: settings.minimumVersion,
    download_url: settings.downloadUrl,
    release_notes: settings.releaseNotes,
    maintenance_mode: settings.maintenanceMode,
    maintenance_message: settings.maintenanceMessage
  });
}

export async function updateAdminVersionSettings(request, env) {
  const requestId = createRequestId();
  if (!env.ADMIN_API_KEY || !env.DB) {
    return adminErrorResponse(requestId, "SERVER_CONFIGURATION_ERROR", "サーバー設定が完了していません。", 500);
  }
  if (!isAdminAuthorized(request, env)) {
    return adminErrorResponse(requestId, "UNAUTHORIZED", "管理者認証に失敗しました。", 401);
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return adminErrorResponse(requestId, "INVALID_CONTENT_TYPE", "Content-Typeにはapplication/jsonを指定してください。", 415);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return adminErrorResponse(requestId, "INVALID_JSON", "送信データの形式が正しくありません。", 400);
  }
  const latestVersion = typeof body.latest_version === "string" ? body.latest_version.trim() : "";
  const minimumVersion = typeof body.minimum_version === "string" ? body.minimum_version.trim() : "";
  const downloadUrl = typeof body.download_url === "string" ? body.download_url.trim() : "";
  const releaseNotes = typeof body.release_notes === "string" ? body.release_notes.trim() : "";
  const maintenanceMode = body.maintenance_mode === true;
  const maintenanceMessage = typeof body.maintenance_message === "string" && body.maintenance_message.trim() !== ""
    ? body.maintenance_message.trim()
    : "現在、ライセンス認証サーバーはメンテナンス中です。";

  if (!APP_VERSION_PATTERN.test(latestVersion) || !APP_VERSION_PATTERN.test(minimumVersion)) {
    return adminErrorResponse(requestId, "INVALID_VERSION", "バージョンは1.2.3形式で入力してください。", 400);
  }
  if (compareVersions(minimumVersion, latestVersion) > 0) {
    return adminErrorResponse(requestId, "MINIMUM_VERSION_TOO_HIGH", "最低対応バージョンは最新バージョン以下にしてください。", 400);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return adminErrorResponse(requestId, "INVALID_DOWNLOAD_URL", "ダウンロードURLの形式が正しくありません。", 400);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return adminErrorResponse(requestId, "INVALID_DOWNLOAD_URL", "ダウンロードURLにはHTTPまたはHTTPSを指定してください。", 400);
  }
  if (releaseNotes.length > 10000 || maintenanceMessage.length > 1000) {
    return adminErrorResponse(requestId, "TEXT_TOO_LONG", "更新内容またはメンテナンスメッセージが長すぎます。", 400);
  }

  const repository = new SettingsRepository(env.DB);
  const before = await repository.getLegacyVersionSettings();
  await repository.updateVersionSettings({
    latestVersion,
    minimumVersion,
    downloadUrl,
    releaseNotes,
    maintenanceMode,
    maintenanceMessage
  });
  const after = await repository.getLegacyVersionSettings();
  const now = new Date().toISOString();
  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId: null,
    action: "VERSION_SETTINGS_UPDATE",
    beforeValue: {
      latest_version: before.latestVersion,
      minimum_version: before.minimumVersion,
      download_url: before.downloadUrl,
      release_notes: before.releaseNotes,
      maintenance_mode: before.maintenanceMode,
      maintenance_message: before.maintenanceMessage
    },
    afterValue: {
      latest_version: after.latestVersion,
      minimum_version: after.minimumVersion,
      download_url: after.downloadUrl,
      release_notes: after.releaseNotes,
      maintenance_mode: after.maintenanceMode,
      maintenance_message: after.maintenanceMessage
    },
    note: "Voicon License Managerからバージョン配布設定を更新",
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    createdAt: now
  });
  return adminSuccessResponse(requestId, {
    latest_version: after.latestVersion,
    minimum_version: after.minimumVersion,
    download_url: after.downloadUrl,
    release_notes: after.releaseNotes,
    maintenance_mode: after.maintenanceMode,
    maintenance_message: after.maintenanceMessage
  });
}
