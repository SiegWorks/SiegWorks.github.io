import { DeviceRepository } from "../repositories/device-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { jsonResponse } from "../utils/http.js";

export async function getAdminDeviceList(request, env, licenseIdText) {
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
  const license = await new LicenseRepository(env.DB).findAdminById(licenseId);
  if (!license) {
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
  const rows = await new DeviceRepository(env.DB).findAllByLicenseId(licenseId);
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: rows.map((row) => ({
      id: Number(row.id),
      license_id: Number(row.license_id),
      device_hash: row.device_hash,
      registered_at: row.registered_at,
      last_auth_at: row.last_auth_at,
      last_client_time_utc: row.last_client_time_utc,
      last_clock_difference_seconds: row.last_clock_difference_seconds == null
        ? null
        : Number(row.last_clock_difference_seconds),
      last_app_version: row.last_app_version,
      last_os_version: row.last_os_version
    }))
  });
}
