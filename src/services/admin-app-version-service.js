import { APP_VERSION_PATTERN } from "../config/constants.js";
import { ApplicationRepository } from "../repositories/application-repository.js";
import { AppVersionRepository } from "../repositories/app-version-repository.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { adminErrorResponse, adminSuccessResponse, createRequestId, getClientIp, getUserAgent, isAdminAuthorized } from "../utils/http.js";
import { compareVersions } from "../utils/version.js";

const APP_ID_PATTERN = /^[a-z0-9_]+$/;
const CHANNEL_PATTERN = /^[a-z0-9_-]+$/;
const DEFAULT_CHANNEL = "release";

function ensureAdminAccess(request, env, requestId) {
  if (!env.ADMIN_API_KEY || !env.DB) {
    return adminErrorResponse(requestId, "SERVER_CONFIGURATION_ERROR", "サーバー設定が完了していません。", 500);
  }
  if (!isAdminAuthorized(request, env)) {
    return adminErrorResponse(requestId, "UNAUTHORIZED", "管理者認証に失敗しました。", 401);
  }
  return null;
}

function normalizeAppId(appIdText) {
  return typeof appIdText === "string" ? appIdText.trim() : "";
}

function toAdminVersionData(row) {
  return {
    app_id: row.app_id,
    display_name: row.display_name,
    is_active: Number(row.is_active) === 1,
    channel: row.channel ?? DEFAULT_CHANNEL,
    latest_version: row.latest_version ?? null,
    minimum_version: row.minimum_version ?? null,
    download_url: row.download_url ?? "",
    release_notes: row.release_notes ?? "",
    maintenance_mode: Number(row.maintenance_mode) === 1,
    maintenance_message: row.maintenance_message ?? "",
    published_at: row.published_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

export async function getAdminAppList(request, env) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId);
  if (accessError) return accessError;

  const rows = await new ApplicationRepository(env.DB).listActive();
  return adminSuccessResponse(requestId, rows.map(row => ({
    app_id: row.app_id,
    display_name: row.display_name,
    is_active: Number(row.is_active) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  })));
}

export async function getAdminAppVersion(request, env, appIdText) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId);
  if (accessError) return accessError;

  const appId = normalizeAppId(appIdText);
  if (!APP_ID_PATTERN.test(appId)) {
    return adminErrorResponse(requestId, "INVALID_APP_ID", "アプリIDの形式が正しくありません。", 400);
  }

  const row = await new AppVersionRepository(env.DB)
    .findByAppIdAndChannel(appId, DEFAULT_CHANNEL);
  if (!row) {
    return adminErrorResponse(requestId, "APP_NOT_FOUND", "指定されたアプリが見つかりません。", 404);
  }

  return adminSuccessResponse(requestId, toAdminVersionData(row));
}

export async function updateAdminAppVersion(request, env, appIdText) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId);
  if (accessError) return accessError;

  const appId = normalizeAppId(appIdText);
  if (!APP_ID_PATTERN.test(appId)) {
    return adminErrorResponse(requestId, "INVALID_APP_ID", "アプリIDの形式が正しくありません。", 400);
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

  const application = await new ApplicationRepository(env.DB).findByAppId(appId);
  if (!application) {
    return adminErrorResponse(requestId, "APP_NOT_FOUND", "指定されたアプリが見つかりません。", 404);
  }

  const channel = typeof body.channel === "string" && body.channel.trim() !== ""
    ? body.channel.trim()
    : DEFAULT_CHANNEL;
  const latestVersion = typeof body.latest_version === "string" ? body.latest_version.trim() : "";
  const minimumVersion = typeof body.minimum_version === "string" ? body.minimum_version.trim() : "";
  const downloadUrl = typeof body.download_url === "string" ? body.download_url.trim() : "";
  const releaseNotes = typeof body.release_notes === "string" ? body.release_notes.trim() : "";
  const maintenanceMode = body.maintenance_mode === true;
  const maintenanceMessage = typeof body.maintenance_message === "string"
    ? body.maintenance_message.trim()
    : "";
  const publishedAt = body.published_at == null || body.published_at === ""
    ? null
    : typeof body.published_at === "string" ? body.published_at.trim() : "";

  if (!CHANNEL_PATTERN.test(channel)) {
    return adminErrorResponse(requestId, "INVALID_CHANNEL", "配布チャンネルの形式が正しくありません。", 400);
  }
  if (!APP_VERSION_PATTERN.test(latestVersion) || !APP_VERSION_PATTERN.test(minimumVersion)) {
    return adminErrorResponse(requestId, "INVALID_VERSION", "バージョンは1.2.3形式で入力してください。", 400);
  }
  if (compareVersions(minimumVersion, latestVersion) > 0) {
    return adminErrorResponse(requestId, "MINIMUM_VERSION_TOO_HIGH", "最低対応バージョンは最新バージョン以下にしてください。", 400);
  }
  if (downloadUrl !== "") {
    let parsedUrl;
    try {
      parsedUrl = new URL(downloadUrl);
    } catch {
      return adminErrorResponse(requestId, "INVALID_DOWNLOAD_URL", "ダウンロードURLの形式が正しくありません。", 400);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return adminErrorResponse(requestId, "INVALID_DOWNLOAD_URL", "ダウンロードURLにはHTTPまたはHTTPSを指定してください。", 400);
    }
  }
  if (releaseNotes.length > 10000 || maintenanceMessage.length > 1000) {
    return adminErrorResponse(requestId, "TEXT_TOO_LONG", "更新内容またはメンテナンスメッセージが長すぎます。", 400);
  }
  if (publishedAt !== null && (publishedAt === "" || Number.isNaN(Date.parse(publishedAt)))) {
    return adminErrorResponse(requestId, "INVALID_PUBLISHED_AT", "公開日時の形式が正しくありません。", 400);
  }

  const updatedAt = new Date().toISOString();
  const repository = new AppVersionRepository(env.DB);
  const beforeRow = await repository.findByAppIdAndChannel(appId, channel);
  await repository.upsert({
    appId,
    channel,
    latestVersion,
    minimumVersion,
    downloadUrl,
    releaseNotes,
    maintenanceMode,
    maintenanceMessage,
    publishedAt: publishedAt === null ? null : new Date(publishedAt).toISOString(),
    updatedAt
  });

  const after = await repository.findByAppIdAndChannel(appId, channel);
  const beforeValue = beforeRow ? toAdminVersionData(beforeRow) : null;
  const afterValue = toAdminVersionData(after);

  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId: null,
    appId,
    action: "APP_VERSION_SETTINGS_UPDATE",
    beforeValue,
    afterValue,
    note: JSON.stringify({
      app_id: appId,
      channel,
      source: "Voicon License Manager"
    }),
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    createdAt: updatedAt
  });

  return adminSuccessResponse(requestId, afterValue);
}
