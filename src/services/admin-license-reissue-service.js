import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { StripeOrderRepository } from "../repositories/stripe-order-repository.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import {
  adminErrorResponse,
  adminSuccessResponse,
  createRequestId,
  getClientIp,
  getUserAgent,
  isAdminAuthorized
} from "../utils/http.js";
import { generateLicenseKey } from "../utils/license-key.js";

const MAX_LICENSE_KEY_GENERATION_ATTEMPTS = 5;

/**
 * 既存ライセンスのキーを再発行します。
 *
 * ライセンスID、有効期限、端末登録、購入履歴は維持し、
 * license_hashだけを新しいキーへ差し替えます。
 * 古いキーは更新直後から認証できなくなります。
 */
export async function reissueAdminLicenseKey(
  request,
  env,
  licenseIdText
) {
  const requestId = createRequestId();

  try {
    if (
      !env.ADMIN_API_KEY ||
      !env.LICENSE_HMAC_KEY ||
      !env.DB
    ) {
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

    const licenseId = parseLicenseId(licenseIdText);

    if (licenseId === null) {
      return adminErrorResponse(
        requestId,
        "INVALID_LICENSE_ID",
        "ライセンスIDの形式が正しくありません。",
        400,
        null,
        true
      );
    }

    let note = null;
    const contentType = request.headers.get("Content-Type") ?? "";

    if (contentType.trim() !== "") {
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

      if (body?.note != null) {
        if (typeof body.note !== "string") {
          return adminErrorResponse(
            requestId,
            "INVALID_NOTE",
            "再発行理由の形式が正しくありません。",
            400,
            null,
            true
          );
        }

        const trimmedNote = body.note.trim();
        if (trimmedNote.length > 500) {
          return adminErrorResponse(
            requestId,
            "NOTE_TOO_LONG",
            "再発行理由は500文字以内で入力してください。",
            400,
            null,
            true
          );
        }
        note = trimmedNote === "" ? null : trimmedNote;
      }
    }

    const licenseRepository = new LicenseRepository(env.DB);
    const before = await licenseRepository.findAdminById(licenseId);

    if (!before) {
      return adminErrorResponse(
        requestId,
        "LICENSE_NOT_FOUND",
        "指定されたライセンスが見つかりません。",
        404,
        null,
        true
      );
    }

    if (before.status !== "active") {
      return adminErrorResponse(
        requestId,
        "LICENSE_NOT_ACTIVE",
        "無効なライセンスのキーは再発行できません。先にライセンスを有効化してください。",
        409,
        {
          license_id: licenseId,
          status: before.status
        },
        true
      );
    }

    const now = new Date().toISOString();
    const generated = await generateUniqueLicenseKey(
      licenseRepository,
      env.LICENSE_HMAC_KEY
    );

    const changedRows = await licenseRepository.rotateLicenseHash(
      licenseId,
      generated.licenseHash,
      now
    );

    if (changedRows !== 1) {
      return adminErrorResponse(
        requestId,
        "LICENSE_KEY_REISSUE_FAILED",
        "ライセンスキーを再発行できませんでした。",
        500,
        null,
        true
      );
    }

    // 購入完了ページに一時保存されている旧キーを表示させない。
    await new StripeOrderRepository(env.DB)
      .clearLicenseKeyDisplayByLicenseId(licenseId);

    await new AdminAuditLogRepository(env.DB).insert({
      requestId,
      licenseId,
      action: "LICENSE_KEY_REISSUE",
      beforeValue: {
        status: before.status,
        updated_at: before.updated_at
      },
      afterValue: {
        status: before.status,
        updated_at: now,
        key_reissued: true
      },
      note: note ?? "ライセンスキー紛失等による再発行",
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
      createdAt: now
    });

    const data = {
      license: {
        id: licenseId,
        licenseKey: generated.licenseKey,
        customerName: before.customer_name,
        customerEmail: before.customer_email,
        status: before.status,
        expiresAt: before.expires_at,
        isLifetime: Number(before.is_lifetime) === 1,
        updatedAt: now
      },
      warning:
        "新しいライセンスキーはこの応答でのみ表示されます。旧ライセンスキーは無効になりました。"
    };

    return adminSuccessResponse(
      requestId,
      data,
      200,
      data
    );
  } catch (error) {
    console.error(
      "Admin license key reissue failed:",
      requestId,
      error
    );

    return adminErrorResponse(
      requestId,
      "INTERNAL_ERROR",
      "ライセンスキーの再発行処理でエラーが発生しました。",
      500,
      null,
      true
    );
  }
}

function parseLicenseId(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }

  const licenseId = Number.parseInt(value, 10);
  return Number.isSafeInteger(licenseId) && licenseId > 0
    ? licenseId
    : null;
}

async function generateUniqueLicenseKey(repository, hmacKey) {
  for (
    let attempt = 0;
    attempt < MAX_LICENSE_KEY_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const licenseKey = generateLicenseKey();
    const licenseHash = await createHmacSha256Hex(
      licenseKey,
      hmacKey
    );

    const existing = await repository.findByHash(licenseHash);
    if (!existing) {
      return { licenseKey, licenseHash };
    }
  }

  throw new Error("A unique license key could not be generated.");
}
