import { DEVICE_HASH_PATTERN, UUID_PATTERN } from "../config/constants.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { AuthLogRepository } from "../repositories/auth-log-repository.js";
import { DeviceRepository } from "../repositories/device-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";
import { normalizeLicenseKey } from "../utils/license-key.js";

export async function deactivateLicense(request, env) {
  if (!env.LICENSE_HMAC_KEY || !env.DB) {
    return jsonResponse(
      {
        success: false,
        errorCode: "SERVER_CONFIGURATION_ERROR",
        message: "\u30B5\u30FC\u30D0\u30FC\u8A2D\u5B9A\u304C\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002"
      },
      500
    );
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_CONTENT_TYPE",
        message: "Content-Type\u306B\u306Fapplication/json\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      },
      415
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_JSON",
        message: "\u9001\u4FE1\u30C7\u30FC\u30BF\u3092JSON\u3068\u3057\u3066\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const normalizedLicenseKey = normalizeLicenseKey(body.licenseKey);
  if (!normalizedLicenseKey) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_LICENSE_KEY_FORMAT",
        message: "\u30E9\u30A4\u30BB\u30F3\u30B9\u30AD\u30FC\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const deviceHash = typeof body.deviceHash === "string" ? body.deviceHash.trim().toLowerCase() : "";
  if (!DEVICE_HASH_PATTERN.test(deviceHash)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_DEVICE_HASH",
        message: "\u7AEF\u672B\u8B58\u5225\u60C5\u5831\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const clientTimeUtc = typeof body.clientTimeUtc === "string" ? body.clientTimeUtc.trim() : "";
  if (!clientTimeUtc.endsWith("Z")) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_CLIENT_TIME",
        message: "\u7AEF\u672B\u6642\u523B\u306FUTC\u5F62\u5F0F\u3067\u9001\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      },
      400
    );
  }
  const parsedClientTime = new Date(clientTimeUtc);
  if (Number.isNaN(parsedClientTime.getTime())) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_CLIENT_TIME",
        message: "\u7AEF\u672B\u6642\u523B\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!UUID_PATTERN.test(requestId)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_REQUEST_ID",
        message: "requestId\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const serverTimeUtc = (/* @__PURE__ */ new Date()).toISOString();
  const clockDifferenceSeconds = Math.round(
    Math.abs(
      Date.parse(serverTimeUtc) - parsedClientTime.getTime()
    ) / 1e3
  );
  const settings = await new SettingsRepository(
    env.DB
  ).getLicenseServerSettings();
  if (settings.maintenanceMode) {
    return jsonResponse(
      {
        success: false,
        errorCode: "MAINTENANCE_MODE",
        requestId,
        serverTimeUtc,
        message: settings.maintenanceMessage
      },
      503
    );
  }
  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);
  const authLogRepository = new AuthLogRepository(env.DB);
  const licenseHash = await createHmacSha256Hex(
    normalizedLicenseKey,
    env.LICENSE_HMAC_KEY
  );
  const license = await new LicenseRepository(
    env.DB
  ).findByHash(licenseHash);
  if (!license) {
    await authLogRepository.insert({
      requestId,
      licenseId: null,
      deviceHash,
      authResult: "FAILURE",
      errorCode: "LICENSE_NOT_FOUND",
      clientTimeUtc,
      serverTimeUtc,
      clockDifferenceSeconds,
      appVersion: null,
      osVersion: null,
      ipAddress,
      userAgent
    });
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_NOT_FOUND",
        requestId,
        serverTimeUtc,
        message: "\u30E9\u30A4\u30BB\u30F3\u30B9\u30AD\u30FC\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
      },
      403
    );
  }
  if (clockDifferenceSeconds > settings.clockToleranceSeconds) {
    await authLogRepository.insert({
      requestId,
      licenseId: license.id,
      deviceHash,
      authResult: "FAILURE",
      errorCode: "CLIENT_TIME_INVALID",
      clientTimeUtc,
      serverTimeUtc,
      clockDifferenceSeconds,
      appVersion: null,
      osVersion: null,
      ipAddress,
      userAgent
    });
    return jsonResponse(
      {
        success: false,
        errorCode: "CLIENT_TIME_INVALID",
        requestId,
        serverTimeUtc,
        message: "\u30D1\u30BD\u30B3\u30F3\u306E\u65E5\u6642\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002Windows\u306E\u6642\u523B\u3092\u81EA\u52D5\u8A2D\u5B9A\u306B\u3057\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"
      },
      403
    );
  }
  if (license.status === "suspended") {
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_SUSPENDED",
        requestId,
        serverTimeUtc,
        message: "\u505C\u6B62\u4E2D\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u7AEF\u672B\u89E3\u9664\u3067\u304D\u307E\u305B\u3093\u3002"
      },
      403
    );
  }
  const deviceRepository = new DeviceRepository(env.DB);
  const device = await deviceRepository.findByLicenseId(license.id);
  if (!device || device.device_hash !== deviceHash) {
    await authLogRepository.insert({
      requestId,
      licenseId: license.id,
      deviceHash,
      authResult: "FAILURE",
      errorCode: "DEVICE_MISMATCH",
      clientTimeUtc,
      serverTimeUtc,
      clockDifferenceSeconds,
      appVersion: null,
      osVersion: null,
      ipAddress,
      userAgent
    });
    return jsonResponse(
      {
        success: false,
        errorCode: "DEVICE_MISMATCH",
        requestId,
        serverTimeUtc,
        message: "\u3053\u306E\u30D1\u30BD\u30B3\u30F3\u306F\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u767B\u9332\u7AEF\u672B\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      403
    );
  }
  await deviceRepository.deleteByLicenseId(license.id);
  await authLogRepository.insert({
    requestId,
    licenseId: license.id,
    deviceHash,
    authResult: "SUCCESS",
    errorCode: null,
    clientTimeUtc,
    serverTimeUtc,
    clockDifferenceSeconds,
    appVersion: null,
    osVersion: null,
    ipAddress,
    userAgent
  });
  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId: license.id,
    action: "SELF_DEVICE_DEACTIVATE",
    beforeValue: {
      deviceHash: device.device_hash,
      registeredAt: device.registered_at
    },
    afterValue: null,
    note: "Voicon\u30A2\u30D7\u30EA\u304B\u3089\u767B\u9332\u7AEF\u672B\u672C\u4EBA\u304C\u89E3\u9664",
    ipAddress,
    userAgent,
    createdAt: serverTimeUtc
  });
  return jsonResponse({
    success: true,
    errorCode: null,
    requestId,
    serverTimeUtc,
    message: "\u3053\u306E\u30D1\u30BD\u30B3\u30F3\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u767B\u9332\u3092\u89E3\u9664\u3057\u307E\u3057\u305F\u3002"
  });
}
