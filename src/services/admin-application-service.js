import { ApplicationRepository } from "../repositories/application-repository.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { adminErrorResponse, adminSuccessResponse, createRequestId, getClientIp, getUserAgent, isAdminAuthorized } from "../utils/http.js";

const APP_ID_PATTERN = /^[a-z0-9_]+$/;

function ensureAdminAccess(request, env, requestId) {
  if (!env.ADMIN_API_KEY || !env.DB) return adminErrorResponse(requestId, "SERVER_CONFIGURATION_ERROR", "サーバー設定が完了していません。", 500);
  if (!isAdminAuthorized(request, env)) return adminErrorResponse(requestId, "UNAUTHORIZED", "管理者認証に失敗しました。", 401);
  return null;
}

function mapRow(row) {
  return { app_id: row.app_id, display_name: row.display_name, is_active: Number(row.is_active) === 1, created_at: row.created_at, updated_at: row.updated_at };
}

async function readBody(request, requestId) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return { error: adminErrorResponse(requestId, "INVALID_CONTENT_TYPE", "Content-Typeにはapplication/jsonを指定してください。", 415) };
  try { return { body: await request.json() }; }
  catch { return { error: adminErrorResponse(requestId, "INVALID_JSON", "送信データの形式が正しくありません。", 400) }; }
}

export async function getAdminApplications(request, env) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId); if (accessError) return accessError;
  const rows = await new ApplicationRepository(env.DB).listAll();
  return adminSuccessResponse(requestId, rows.map(mapRow));
}

export async function createAdminApplication(request, env) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId); if (accessError) return accessError;
  const parsed = await readBody(request, requestId); if (parsed.error) return parsed.error;
  const appId = typeof parsed.body.app_id === "string" ? parsed.body.app_id.trim() : "";
  const displayName = typeof parsed.body.display_name === "string" ? parsed.body.display_name.trim() : "";
  const isActive = parsed.body.is_active !== false;
  if (!APP_ID_PATTERN.test(appId)) return adminErrorResponse(requestId, "INVALID_APP_ID", "app_idは小文字英数字とアンダースコアで入力してください。", 400);
  if (!displayName || displayName.length > 100) return adminErrorResponse(requestId, "INVALID_DISPLAY_NAME", "表示名を1～100文字で入力してください。", 400);
  const repo = new ApplicationRepository(env.DB);
  if (await repo.findByAppId(appId)) return adminErrorResponse(requestId, "APP_ALREADY_EXISTS", "同じapp_idのアプリが既に登録されています。", 409);
  const now = new Date().toISOString();
  await repo.insert({ appId, displayName, isActive, createdAt: now, updatedAt: now });
  const after = mapRow(await repo.findByAppId(appId));
  await new AdminAuditLogRepository(env.DB).insert({ requestId, licenseId: null, appId, action: "APPLICATION_CREATE", beforeValue: null, afterValue: after, note: "Voicon License Manager", ipAddress: getClientIp(request), userAgent: getUserAgent(request), createdAt: now });
  return adminSuccessResponse(requestId, after, 201);
}

export async function updateAdminApplication(request, env, appIdText) {
  const requestId = createRequestId();
  const accessError = ensureAdminAccess(request, env, requestId); if (accessError) return accessError;
  const appId = decodeURIComponent(appIdText).trim();
  if (!APP_ID_PATTERN.test(appId)) return adminErrorResponse(requestId, "INVALID_APP_ID", "app_idの形式が正しくありません。", 400);
  const parsed = await readBody(request, requestId); if (parsed.error) return parsed.error;
  const displayName = typeof parsed.body.display_name === "string" ? parsed.body.display_name.trim() : "";
  const isActive = parsed.body.is_active === true;
  if (!displayName || displayName.length > 100) return adminErrorResponse(requestId, "INVALID_DISPLAY_NAME", "表示名を1～100文字で入力してください。", 400);
  const repo = new ApplicationRepository(env.DB);
  const beforeRow = await repo.findByAppId(appId);
  if (!beforeRow) return adminErrorResponse(requestId, "APP_NOT_FOUND", "指定されたアプリが見つかりません。", 404);
  const before = mapRow(beforeRow); const now = new Date().toISOString();
  await repo.update({ appId, displayName, isActive, updatedAt: now });
  const after = mapRow(await repo.findByAppId(appId));
  await new AdminAuditLogRepository(env.DB).insert({ requestId, licenseId: null, appId, action: "APPLICATION_UPDATE", beforeValue: before, afterValue: after, note: "Voicon License Manager", ipAddress: getClientIp(request), userAgent: getUserAgent(request), createdAt: now });
  return adminSuccessResponse(requestId, after);
}
