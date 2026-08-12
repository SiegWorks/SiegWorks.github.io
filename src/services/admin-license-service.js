import { LicenseRepository } from "../repositories/license-repository.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import { adminErrorResponse, adminSuccessResponse, createRequestId, isAdminAuthorized } from "../utils/http.js";
import { generateLicenseKey } from "../utils/license-key.js";

export async function createLicense(request, env) {
  const requestId = createRequestId();
  try {
    if (!env.ADMIN_API_KEY || !env.LICENSE_HMAC_KEY || !env.DB) {
      return adminErrorResponse(
        requestId,
        "SERVER_CONFIGURATION_ERROR",
        "サーバー設定が完了していません。",
        500,
        null,
        true
      );
    }
    if (!isAdminAuthorized(request, env)) {
      return adminErrorResponse(
        requestId,
        "UNAUTHORIZED",
        "管理者認証に失敗しました。",
        401,
        null,
        true
      );
    }
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return adminErrorResponse(
        requestId,
        "INVALID_CONTENT_TYPE",
        "Content-Typeにはapplication/jsonを指定してください。",
        415,
        null,
        true
      );
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return adminErrorResponse(
        requestId,
        "INVALID_JSON",
        "送信データの形式が正しくありません。",
        400,
        null,
        true
      );
    }
    const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
    if (customerName.length === 0) {
      return adminErrorResponse(
        requestId,
        "CUSTOMER_NAME_REQUIRED",
        "顧客名を入力してください。",
        400,
        null,
        true
      );
    }
    if (customerName.length > 200) {
      return adminErrorResponse(
        requestId,
        "CUSTOMER_NAME_TOO_LONG",
        "顧客名が長すぎます。",
        400,
        null,
        true
      );
    }
    const customerEmail = typeof body.customerEmail === "string" && body.customerEmail.trim() !== "" ? body.customerEmail.trim() : null;
    if (customerEmail !== null && customerEmail.length > 320) {
      return adminErrorResponse(
        requestId,
        "CUSTOMER_EMAIL_TOO_LONG",
        "メールアドレスが長すぎます。",
        400,
        null,
        true
      );
    }
    const edition = typeof body.edition === "string" && body.edition.trim() !== ""
      ? body.edition.trim().toLowerCase()
      : "ed_voicon";
    if (!["ed_voicon", "ed_dcs_localizer"].includes(edition)) {
      return adminErrorResponse(
        requestId,
        "EDITION_INVALID",
        "エディションにはed_voiconまたはed_dcs_localizerを指定してください。",
        400,
        null,
        true
      );
    }
    const channel = typeof body.channel === "string" && body.channel.trim() !== "" ? body.channel.trim().toLowerCase() : "release";
    const memo = typeof body.memo === "string" && body.memo.trim() !== "" ? body.memo.trim() : null;
    const isLifetime = body.isLifetime === true;
    let expiresAt = null;
    if (!isLifetime) {
      if (typeof body.expiresAt !== "string" || body.expiresAt.trim() === "") {
        return adminErrorResponse(
          requestId,
          "EXPIRES_AT_REQUIRED",
          "期間ライセンスには有効期限が必要です。",
          400,
          null,
          true
        );
      }
      const parsedExpiresAt = new Date(body.expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime())) {
        return adminErrorResponse(
          requestId,
          "INVALID_EXPIRES_AT",
          "有効期限の形式が正しくありません。",
          400,
          null,
          true
        );
      }
      if (parsedExpiresAt.getTime() <= Date.now()) {
        return adminErrorResponse(
          requestId,
          "EXPIRES_AT_IN_PAST",
          "有効期限には未来の日時を指定してください。",
          400,
          null,
          true
        );
      }
      expiresAt = parsedExpiresAt.toISOString();
    }
    const licenseKey = generateLicenseKey();
    const licenseHash = await createHmacSha256Hex(licenseKey, env.LICENSE_HMAC_KEY);
    const now = new Date().toISOString();
    const repository = new LicenseRepository(env.DB);
    const id = await repository.insert({
      licenseHash,
      customerName,
      customerEmail,
      edition,
      channel,
      expiresAt,
      isLifetime,
      memo,
      now
    });
    const license = {
      id,
      licenseKey,
      customerName,
      customerEmail,
      edition,
      channel,
      status: "active",
      expiresAt,
      isLifetime,
      memo,
      createdAt: now
    };
    const warning = "ライセンスキーはこの応答でのみ表示されます。安全な場所へ保存してください。";
    return adminSuccessResponse(
      requestId,
      { license, warning },
      201,
      { license, warning }
    );
  } catch (error) {
    console.error("Admin create license failed:", requestId, error);
    return adminErrorResponse(
      requestId,
      "INTERNAL_ERROR",
      "ライセンス発行処理でエラーが発生しました。",
      500,
      null,
      true
    );
  }
}
