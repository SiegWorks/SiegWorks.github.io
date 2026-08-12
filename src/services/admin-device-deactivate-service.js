import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { DeviceRepository } from "../repositories/device-repository.js";
import { DeviceReleaseMarkerRepository } from "../repositories/device-release-marker-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";

export async function deactivateAdminDevice(request, env, licenseIdText, deviceIdText) {
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
  if (!/^\d+$/.test(deviceIdText)) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_DEVICE_ID",
          message: "端末IDの形式が正しくありません。"
        }
      },
      400
    );
  }
  const licenseId = Number.parseInt(licenseIdText, 10);
  const deviceId = Number.parseInt(deviceIdText, 10);
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
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_DEVICE_ID",
          message: "端末IDの形式が正しくありません。"
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
  const deviceRepository = new DeviceRepository(env.DB);
  const device = await deviceRepository.findByIdAndLicenseId(deviceId, licenseId);
  if (!device) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "DEVICE_NOT_FOUND",
          message: "指定された端末登録が見つかりません。"
        }
      },
      404
    );
  }
  const now = new Date().toISOString();
  try {
    await new DeviceReleaseMarkerRepository(env.DB).releaseDevice({
      deviceId,
      licenseId,
      deviceHash: device.device_hash,
      releasedAt: now,
      releasedBy: "manager"
    });
  } catch {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "DEVICE_DEACTIVATE_FAILED",
          message: "端末登録を解除できませんでした。"
        }
      },
      500
    );
  }
  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId,
    action: "MANAGER_DEVICE_DEACTIVATE",
    beforeValue: {
      device_id: Number(device.id),
      device_hash: device.device_hash,
      registered_at: device.registered_at,
      last_auth_at: device.last_auth_at
    },
    afterValue: null,
    note: "Voicon License Managerから登録端末を解除",
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    createdAt: now
  });
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      license_id: licenseId,
      device_id: deviceId,
      deactivated: true,
      deactivated_at: now
    }
  });
}
