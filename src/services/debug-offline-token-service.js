import { DEVICE_HASH_PATTERN } from "../config/constants.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { DeviceRepository } from "../repositories/device-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { bytesToBase64Url, textToBase64Url } from "../utils/base64url.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";
import { normalizeLicenseKey } from "../utils/license-key.js";
import { pemToPkcs8Bytes } from "../utils/pem.js";

export async function createOfflineTokenWithExplicitTimes(input) {
  const header = {
    alg: "ES256",
    typ: "VCN-OFFLINE",
    kid: input.keyId
  };
  const payload = {
    licenseId: input.license.id,
    deviceHash: input.deviceHash,
    issuedAtUtc: input.issuedAtUtc,
    validUntilUtc: input.validUntilUtc,
    licenseExpiresAtUtc: input.licenseExpiresAtUtc,
    isLifetime: input.license.is_lifetime === 1,
    edition: input.license.edition,
    channel: input.license.channel
  };
  const encodedHeader = textToBase64Url(JSON.stringify(header));
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(input.privateKeyPem),
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export function isDebugTokenApiEnabled(env) {
  return String(env.ENABLE_DEBUG_TOKEN_API ?? "").toLowerCase() === "true";
}

export function debugApiDisabledResponse(requestId) {
  return jsonResponse(
    {
      success: false,
      errorCode: "DEBUG_API_DISABLED",
      requestId,
      message: "デバッグ用オフライントークン再生成APIは無効です。"
    },
    404
  );
}

export function parseRequiredUtcDate(value) {
  if (typeof value !== "string" || !value.endsWith("Z")) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getDebugLicenseContext(request, env) {
  const requestId = crypto.randomUUID();
  if (!isDebugTokenApiEnabled(env)) {
    return debugApiDisabledResponse(requestId);
  }
  if (!env.LICENSE_HMAC_KEY || !env.DB) {
    return jsonResponse(
      {
        success: false,
        errorCode: "SERVER_CONFIGURATION_ERROR",
        requestId,
        message: "サーバー設定が完了していません。"
      },
      500
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
        requestId,
        message: "送信データをJSONとして読み取れません。"
      },
      400
    );
  }

  const normalizedLicenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceHash = typeof body.deviceHash === "string"
    ? body.deviceHash.trim().toLowerCase()
    : "";

  if (!normalizedLicenseKey) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_LICENSE_KEY_FORMAT",
        requestId,
        message: "ライセンスキーの形式が正しくありません。"
      },
      400
    );
  }
  if (!DEVICE_HASH_PATTERN.test(deviceHash)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_DEVICE_HASH",
        requestId,
        message: "端末識別情報の形式が正しくありません。"
      },
      400
    );
  }

  const licenseHash = await createHmacSha256Hex(
    normalizedLicenseKey,
    env.LICENSE_HMAC_KEY
  );
  const license = await new LicenseRepository(env.DB).findByHash(licenseHash);
  if (!license) {
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_NOT_FOUND",
        requestId,
        message: "ライセンスが見つかりません。"
      },
      404
    );
  }

  const device = await new DeviceRepository(env.DB).findByLicenseId(license.id);
  if (!device || device.device_hash !== deviceHash) {
    return jsonResponse(
      {
        success: false,
        errorCode: "DEVICE_MISMATCH",
        requestId,
        message: "現在のPCは、このライセンスの登録端末ではありません。"
      },
      403
    );
  }

  const settings = await new SettingsRepository(env.DB).getLicenseServerSettings();
  const serverTimeUtc = new Date().toISOString();
  const issuedAtUtc = device.last_auth_at || serverTimeUtc;
  const maximumValidUntil =
    Date.parse(issuedAtUtc) + settings.offlineTokenHours * 60 * 60 * 1000;

  let validUntilMilliseconds = maximumValidUntil;
  if (license.is_lifetime !== 1 && license.expires_at) {
    validUntilMilliseconds = Math.min(
      maximumValidUntil,
      Date.parse(license.expires_at)
    );
  }

  return jsonResponse({
    success: true,
    errorCode: null,
    requestId,
    serverTimeUtc,
    debugTokenContext: {
      licenseId: Number(license.id),
      status: license.status,
      createdAtUtc: license.created_at,
      updatedAtUtc: license.updated_at,
      expiresAtUtc: license.expires_at,
      lastAuthAtUtc: device.last_auth_at,
      issuedAtUtc,
      validUntilUtc: new Date(validUntilMilliseconds).toISOString(),
      licenseExpiresAtUtc: license.expires_at,
      edition: license.edition,
      channel: license.channel,
      offlineTokenHours: settings.offlineTokenHours
    }
  });
}

export async function regenerateDebugOfflineToken(request, env) {
  const requestId = crypto.randomUUID();

  if (!isDebugTokenApiEnabled(env)) {
    return debugApiDisabledResponse(requestId);
  }

  if (!env.LICENSE_HMAC_KEY ||
      !env.OFFLINE_TOKEN_PRIVATE_KEY ||
      !env.DB) {
    return jsonResponse(
      {
        success: false,
        errorCode: "SERVER_CONFIGURATION_ERROR",
        requestId,
        message: "サーバー設定が完了していません。"
      },
      500
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
        requestId,
        message: "送信データをJSONとして読み取れません。"
      },
      400
    );
  }

  const normalizedLicenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceHash = typeof body.deviceHash === "string"
    ? body.deviceHash.trim().toLowerCase()
    : "";

  const updateServerDates = body.updateServerDates === true;
  const alignTokenWithServer = body.alignTokenWithServer !== false;

  const requestedServerLastAuth =
    parseRequiredUtcDate(body.serverLastAuthAtUtc);
  const requestedServerExpires =
    parseRequiredUtcDate(body.serverExpiresAtUtc);

  const requestedIssuedAt =
    parseRequiredUtcDate(body.issuedAtUtc);
  const requestedValidUntil =
    parseRequiredUtcDate(body.validUntilUtc);
  const requestedTokenLicenseExpires =
    body.licenseExpiresAtUtc == null
      ? null
      : parseRequiredUtcDate(body.licenseExpiresAtUtc);

  if (!normalizedLicenseKey) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_LICENSE_KEY_FORMAT",
        requestId,
        message: "ライセンスキーの形式が正しくありません。"
      },
      400
    );
  }

  if (!DEVICE_HASH_PATTERN.test(deviceHash)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_DEVICE_HASH",
        requestId,
        message: "端末識別情報の形式が正しくありません。"
      },
      400
    );
  }

  if (updateServerDates &&
      (!requestedServerLastAuth || !requestedServerExpires)) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_SERVER_DEBUG_DATE",
        requestId,
        message: "サーバー側へ設定する最終認証日時または有効期限が正しくありません。"
      },
      400
    );
  }

  if (!alignTokenWithServer &&
      (!requestedIssuedAt ||
       !requestedValidUntil ||
       (body.licenseExpiresAtUtc != null &&
        !requestedTokenLicenseExpires))) {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_DEBUG_TOKEN_DATE",
        requestId,
        message: "デバッグ用トークンの日付形式が正しくありません。"
      },
      400
    );
  }

  const licenseHash = await createHmacSha256Hex(
    normalizedLicenseKey,
    env.LICENSE_HMAC_KEY
  );

  const licenseRepository = new LicenseRepository(env.DB);
  let license = await licenseRepository.findByHash(licenseHash);

  if (!license) {
    return jsonResponse(
      {
        success: false,
        errorCode: "LICENSE_NOT_FOUND",
        requestId,
        message: "ライセンスが見つかりません。"
      },
      404
    );
  }

  const deviceRepository = new DeviceRepository(env.DB);
  let device = await deviceRepository.findByLicenseId(license.id);

  if (!device || device.device_hash !== deviceHash) {
    return jsonResponse(
      {
        success: false,
        errorCode: "DEVICE_MISMATCH",
        requestId,
        message: "現在のPCは、このライセンスの登録端末ではありません。"
      },
      403
    );
  }

  const beforeServerDates = {
    last_auth_at: device.last_auth_at,
    expires_at: license.expires_at
  };

  const now = new Date().toISOString();

  if (updateServerDates) {
    const serverLastAuthAtUtc =
      requestedServerLastAuth.toISOString();
    const serverExpiresAtUtc =
      requestedServerExpires.toISOString();

    const licenseChanges =
      await licenseRepository.updateDebugExpiresAt(
        license.id,
        serverExpiresAtUtc,
        now
      );

    const deviceChanges =
      await deviceRepository.updateDebugLastAuthAt(
        device.id,
        license.id,
        serverLastAuthAtUtc
      );

    if (licenseChanges === 0 || deviceChanges === 0) {
      return jsonResponse(
        {
          success: false,
          errorCode: "DEBUG_SERVER_DATE_UPDATE_FAILED",
          requestId,
          message: "サーバー側のテスト日時を更新できませんでした。"
        },
        500
      );
    }

    license = await licenseRepository.findByHash(licenseHash);
    device = await deviceRepository.findByLicenseId(license.id);
  }

  const settings =
    await new SettingsRepository(env.DB).getLicenseServerSettings();

  const effectiveServerLastAuth =
    parseRequiredUtcDate(device.last_auth_at) ??
    requestedServerLastAuth ??
    new Date();

  const effectiveServerExpires =
    parseRequiredUtcDate(license.expires_at) ??
    requestedServerExpires;

  let issuedAtUtc;
  let validUntilUtc;
  let tokenLicenseExpiresAtUtc;

  if (alignTokenWithServer) {
    issuedAtUtc = effectiveServerLastAuth.toISOString();
    tokenLicenseExpiresAtUtc =
      license.is_lifetime === 1
        ? null
        : effectiveServerExpires?.toISOString() ?? null;

    let validUntilMilliseconds =
      effectiveServerLastAuth.getTime() +
      settings.offlineTokenHours * 60 * 60 * 1000;

    if (tokenLicenseExpiresAtUtc) {
      validUntilMilliseconds = Math.min(
        validUntilMilliseconds,
        Date.parse(tokenLicenseExpiresAtUtc)
      );
    }

    validUntilUtc =
      new Date(validUntilMilliseconds).toISOString();
  } else {
    issuedAtUtc = requestedIssuedAt.toISOString();
    validUntilUtc = requestedValidUntil.toISOString();
    tokenLicenseExpiresAtUtc =
      license.is_lifetime === 1
        ? null
        : requestedTokenLicenseExpires?.toISOString() ??
          license.expires_at;
  }

  const token = await createOfflineTokenWithExplicitTimes({
    license,
    deviceHash,
    issuedAtUtc,
    validUntilUtc,
    licenseExpiresAtUtc: tokenLicenseExpiresAtUtc,
    keyId: settings.offlineTokenKeyId,
    privateKeyPem: env.OFFLINE_TOKEN_PRIVATE_KEY
  });

  const serverTimeUtc = new Date().toISOString();

  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId: license.id,
    action: "DEBUG_OFFLINE_TOKEN_REGENERATE",
    beforeValue: {
      server_last_auth_at: beforeServerDates.last_auth_at,
      server_license_expires_at: beforeServerDates.expires_at
    },
    afterValue: {
      update_server_dates: updateServerDates,
      align_token_with_server: alignTokenWithServer,
      server_last_auth_at: device.last_auth_at,
      server_license_expires_at: license.expires_at,
      issued_at_utc: issuedAtUtc,
      valid_until_utc: validUntilUtc,
      token_license_expires_at_utc: tokenLicenseExpiresAtUtc
    },
    note:
      "Voicon Debugメニューからサーバー日時を設定し、正式署名のテスト用オフライントークンを再生成",
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    createdAt: serverTimeUtc
  });

  return jsonResponse({
    success: true,
    errorCode: null,
    requestId,
    serverTimeUtc,
    offlineToken: token,
    offlineTokenValidUntilUtc: validUntilUtc,
    debugTokenContext: {
      licenseId: Number(license.id),
      status: license.status,
      createdAtUtc: license.created_at,
      updatedAtUtc: license.updated_at,
      expiresAtUtc: license.expires_at,
      lastAuthAtUtc: device.last_auth_at,
      issuedAtUtc,
      validUntilUtc,
      licenseExpiresAtUtc: tokenLicenseExpiresAtUtc,
      edition: license.edition,
      channel: license.channel,
      offlineTokenHours: settings.offlineTokenHours
    },
    license: {
      expiresAtUtc: tokenLicenseExpiresAtUtc,
      isLifetime: license.is_lifetime === 1,
      edition: license.edition,
      channel: license.channel
    },
    message:
      updateServerDates
        ? "サーバー日時を更新し、整合した正式署名トークンを保存しました。"
        : "正式署名のテスト用オフライントークンを再生成しました。"
  });
}
