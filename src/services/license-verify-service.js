import { getDictionaryKeyBundle } from "./dictionary-key-service.js";
import { APP_VERSION_PATTERN, DEVICE_HASH_PATTERN, UUID_PATTERN } from "../config/constants.js";
import { AuthLogRepository } from "../repositories/auth-log-repository.js";
import { DeviceRepository } from "../repositories/device-repository.js";
import { DeviceReleaseMarkerRepository } from "../repositories/device-release-marker-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";
import { normalizeLicenseKey } from "../utils/license-key.js";
import { createOfflineToken } from "./offline-token-service.js";

export async function verifyLicense(request, env) {
  if (!env.LICENSE_HMAC_KEY || !env.OFFLINE_TOKEN_PRIVATE_KEY || !env.DB) {
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
  const requiredFields = [
    "licenseKey",
    "deviceHash",
    "clientTimeUtc",
    "appVersion",
    "requestId"
  ];
  const missingFields = requiredFields.filter((fieldName) => {
    const value = body[fieldName];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missingFields.length > 0) {
    return jsonResponse(
      {
        success: false,
        errorCode: "REQUIRED_FIELD_MISSING",
        message: "\u5FC5\u9808\u9805\u76EE\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059\u3002",
        missingFields
      },
      400
    );
  }
  const normalizedLicenseKey = normalizeLicenseKey(body.licenseKey);
  if (normalizedLicenseKey === null) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_LICENSE_KEY_FORMAT",
        message: "\u30E9\u30A4\u30BB\u30F3\u30B9\u30AD\u30FC\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const deviceHash = body.deviceHash.trim().toLowerCase();
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
  const clientTimeUtc = body.clientTimeUtc.trim();
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
  const appVersion = body.appVersion.trim();
  if (!APP_VERSION_PATTERN.test(appVersion)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_APP_VERSION",
        message: "Voicon\u306E\u30D0\u30FC\u30B8\u30E7\u30F3\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002"
      },
      400
    );
  }
  const osVersion = typeof body.osVersion === "string" && body.osVersion.trim() !== "" ? body.osVersion.trim() : null;
  // Backward compatibility: older clients do not send authenticationMode.
  // Only updated clients explicitly marked as "automatic" are blocked after
  // an administrator releases their device registration.
  const authenticationMode = body.authenticationMode === "automatic"
    ? "automatic"
    : "manual";
  const requestId = body.requestId.trim();
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
  const settingsRepository = new SettingsRepository(env.DB);
  const settings = await settingsRepository.getLicenseServerSettings();
  const authLogRepository = new AuthLogRepository(env.DB);
  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);
  const logFailure = async (errorCode, licenseId) => {
    await authLogRepository.insert({
      requestId,
      licenseId,
      deviceHash,
      authResult: "FAILURE",
      errorCode,
      clientTimeUtc,
      serverTimeUtc,
      clockDifferenceSeconds,
      appVersion,
      osVersion,
      ipAddress,
      userAgent
    });
  };
  if (clockDifferenceSeconds > settings.clockToleranceSeconds) {
    await logFailure("CLIENT_TIME_INVALID", null);
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
  if (settings.maintenanceMode) {
    await logFailure("MAINTENANCE_MODE", null);
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
  const licenseHash = await createHmacSha256Hex(
    normalizedLicenseKey,
    env.LICENSE_HMAC_KEY
  );
  const licenseRepository = new LicenseRepository(env.DB);
  const license = await licenseRepository.findByHash(licenseHash);
  if (!license) {
    await logFailure("LICENSE_NOT_FOUND", null);
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
  if (license.status === "suspended") {
    await logFailure("LICENSE_SUSPENDED", license.id);
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_SUSPENDED",
        requestId,
        serverTimeUtc,
        license: {
          expiresAtUtc: license.expires_at,
          isLifetime: license.is_lifetime === 1,
          edition: license.edition,
          channel: license.channel,
          customerName: license.customer_name,
          customerEmail: license.customer_email
        },
        message: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u73FE\u5728\u505C\u6B62\u3055\u308C\u3066\u3044\u307E\u3059\u3002"
      },
      403
    );
  }
  if (license.is_lifetime !== 1 && (!license.expires_at || Date.parse(license.expires_at) <= Date.parse(serverTimeUtc))) {
    await logFailure("LICENSE_EXPIRED", license.id);
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_EXPIRED",
        requestId,
        serverTimeUtc,
        license: {
          expiresAtUtc: license.expires_at,
          isLifetime: license.is_lifetime === 1,
          edition: license.edition,
          channel: license.channel,
          customerName: license.customer_name,
          customerEmail: license.customer_email
        },
        message: "\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002"
      },
      403
    );
  }
  const deviceRepository = new DeviceRepository(env.DB);
  const releaseMarkerRepository = new DeviceReleaseMarkerRepository(env.DB);
  const device = await deviceRepository.findByLicenseId(license.id);
  let activationType;
  if (!device) {
    const releaseMarker = await releaseMarkerRepository.find(license.id, deviceHash);
    if (releaseMarker && authenticationMode === "automatic") {
      await logFailure("DEVICE_RELEASED", license.id);
      return jsonResponse(
        {
          success: false,
          errorCode: "DEVICE_RELEASED",
          requestId,
          serverTimeUtc,
          license: {
            expiresAtUtc: license.expires_at,
            isLifetime: license.is_lifetime === 1,
            edition: license.edition,
            channel: license.channel,
            customerName: license.customer_name,
            customerEmail: license.customer_email
          },
          message: "このPCのライセンス登録が解除されています。オンライン認証を行ってください。"
        },
        403
      );
    }

    await deviceRepository.register({
      licenseId: license.id,
      deviceHash,
      now: serverTimeUtc,
      clientTimeUtc,
      clockDifferenceSeconds,
      appVersion,
      osVersion
    });
    if (releaseMarker) {
      await releaseMarkerRepository.delete(license.id, deviceHash);
      activationType = "reactivated";
    } else {
      activationType = "new";
    }
  } else {
    if (device.device_hash !== deviceHash) {
      await logFailure("DEVICE_MISMATCH", license.id);
      return jsonResponse(
        {
          success: false,
          errorCode: "DEVICE_MISMATCH",
          requestId,
          serverTimeUtc,
          message: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u5225\u306E\u30D1\u30BD\u30B3\u30F3\u306B\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u3059\u3002"
        },
        403
      );
    }
    await deviceRepository.updateLastAuthentication({
      licenseId: license.id,
      now: serverTimeUtc,
      clientTimeUtc,
      clockDifferenceSeconds,
      appVersion,
      osVersion
    });
    activationType = "existing";
  }
  const offlineToken = await createOfflineToken({
    privateKeyPem: env.OFFLINE_TOKEN_PRIVATE_KEY,
    keyId: settings.offlineTokenKeyId,
    license,
    deviceHash,
    issuedAtUtc: serverTimeUtc,
    offlineTokenHours: settings.offlineTokenHours
  });
  await authLogRepository.insert({
    requestId,
    licenseId: license.id,
    deviceHash,
    authResult: "SUCCESS",
    errorCode: null,
    clientTimeUtc,
    serverTimeUtc,
    clockDifferenceSeconds,
    appVersion,
    osVersion,
    ipAddress,
    userAgent
  });
  return jsonResponse({
    success: true,
    errorCode: null,
    requestId,
    serverTimeUtc,
    activationType,
    license: {
      expiresAtUtc: license.expires_at,
      isLifetime: license.is_lifetime === 1,
      edition: license.edition,
      channel: license.channel,
      customerName: license.customer_name,
      customerEmail: license.customer_email
    },
    offlineToken: offlineToken.token,
    offlineTokenValidUntilUtc: offlineToken.validUntilUtc,
    ...getDictionaryKeyBundle(env, true, offlineToken.validUntilUtc),
    message: null
  });
}
