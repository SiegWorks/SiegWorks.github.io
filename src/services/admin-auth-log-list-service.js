import { AuthLogRepository } from "../repositories/auth-log-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { jsonResponse } from "../utils/http.js";

export async function getAdminAuthLogList(request, env, licenseIdText) {
  const requestId = crypto.randomUUID();
  if (!env.ADMIN_API_KEY || !env.DB) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "SERVER_CONFIGURATION_ERROR",
          message: "サーバー設定が完了していません。"
        }
      },
      500
    );
  }
  const authorization = request.headers.get("Authorization") ?? "";
  const expectedAuthorization = `Bearer ${env.ADMIN_API_KEY}`;
  if (authorization !== expectedAuthorization) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "UNAUTHORIZED",
          message: "管理者認証に失敗しました。"
        }
      },
      401
    );
  }
  const licenseId = Number.parseInt(licenseIdText, 10);
  if (!Number.isInteger(licenseId) || licenseId <= 0) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_LICENSE_ID",
          message: "ライセンスIDが正しくありません。"
        }
      },
      400
    );
  }
  const license = await new LicenseRepository(env.DB).findAdminById(licenseId);
  if (!license) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "LICENSE_NOT_FOUND",
          message: "ライセンスが見つかりません。"
        }
      },
      404
    );
  }
  const url = new URL(request.url);
  const pageText = url.searchParams.get("page") ?? "1";
  const pageSizeText = url.searchParams.get("pageSize") ?? "100";
  const page = Number.parseInt(pageText, 10);
  const pageSize = Number.parseInt(pageSizeText, 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_PAGINATION",
          message: "pageは1以上、pageSizeは1～100で指定してください。"
        }
      },
      400
    );
  }
  const repository = new AuthLogRepository(env.DB);
  const totalCount = await repository.getAdminCountByLicenseId(licenseId);
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const offset = (page - 1) * pageSize;
  const rows = await repository.getAdminListByLicenseId(licenseId, pageSize, offset);
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      items: rows.map((row) => ({
        id: Number(row.id),
        license_id: row.license_id == null ? null : Number(row.license_id),
        device_hash: row.device_hash,
        auth_result: row.auth_result,
        error_code: row.error_code,
        client_time_utc: row.client_time_utc,
        server_time_utc: row.server_time_utc,
        clock_difference_seconds: row.clock_difference_seconds == null ? null : Number(row.clock_difference_seconds),
        app_version: row.app_version,
        os_version: row.os_version,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
        request_id: row.request_id
      })),
      page,
      page_size: pageSize,
      total_count: totalCount,
      total_pages: totalPages
    }
  });
}
