import { LicenseRepository } from "../repositories/license-repository.js";
import { jsonResponse } from "../utils/http.js";

export async function getAdminLicenseDetail(request, env, licenseIdText) {
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
  if (!/^\d+$/.test(licenseIdText)) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_LICENSE_ID",
          message: "ライセンスIDの形式が正しくありません。"
        }
      },
      400
    );
  }
  const licenseId = Number.parseInt(licenseIdText, 10);
  if (!Number.isSafeInteger(licenseId) || licenseId <= 0) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_LICENSE_ID",
          message: "ライセンスIDの形式が正しくありません。"
        }
      },
      400
    );
  }
  const row = await new LicenseRepository(env.DB).findAdminById(licenseId);
  if (!row) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "LICENSE_NOT_FOUND",
          message: "指定されたライセンスが見つかりません。"
        }
      },
      404
    );
  }
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      id: Number(row.id),
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      edition: row.edition,
      channel: row.channel,
      status: row.status,
      expires_at: row.expires_at,
      memo: row.memo,
      device_count: Number(row.device_count ?? 0),
      last_auth_at: row.last_auth_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  });
}
