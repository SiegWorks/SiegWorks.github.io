import { STATUS_REASON_CODES, isAllowedStatusReason } from "../config/status-reason-codes.js";
import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";

function buildConflictResponse(requestId, conflictingLicense) {
  return jsonResponse(
    {
      success: false,
      request_id: requestId,
      error: {
        code: "ACTIVE_LICENSE_ALREADY_EXISTS",
        message: "同じメールアドレスと同じエディションの有効なライセンスが存在するため、このライセンスは有効化できません。",
        details: {
          conflicting_license: {
            id: Number(conflictingLicense.id),
            customer_name: conflictingLicense.customer_name,
            customer_email: conflictingLicense.customer_email,
            status: conflictingLicense.status,
            expires_at: conflictingLicense.expires_at
          }
        }
      }
    },
    409
  );
}

function isActiveEmailUniqueConstraintError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("unique constraint failed") &&
    (normalized.includes("idx_licenses_one_active_per_email_edition") ||
     (normalized.includes("licenses.normalized_email") && normalized.includes("licenses.edition")));
}

function buildAuditNote(reasonCode, reasonComment, extra = {}) {
  return JSON.stringify({
    reason_code: reasonCode,
    reason_comment: reasonComment,
    ...extra
  });
}

function normalizeReasonComment(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function updateAdminLicenseStatus(request, env, licenseIdText) {
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
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_CONTENT_TYPE",
          message: "Content-Typeにはapplication/jsonを指定してください。"
        }
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
        request_id: requestId,
        error: {
          code: "INVALID_JSON",
          message: "送信データをJSONとして読み取れません。"
        }
      },
      400
    );
  }
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (status !== "active" && status !== "suspended") {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_STATUS",
          message: "状態にはactiveまたはsuspendedを指定してください。"
        }
      },
      400
    );
  }
  const reasonCode = typeof body.reason_code === "string"
    ? body.reason_code.trim().toUpperCase()
    : "";
  const reasonComment = normalizeReasonComment(body.reason_comment);

  const repository = new LicenseRepository(env.DB);
  const before = await repository.findAdminById(licenseId);
  if (!before) {
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

  if (before.status !== status) {
    if (!reasonCode) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "STATUS_REASON_REQUIRED",
            message: "ライセンス状態を変更する理由を指定してください。"
          }
        },
        400
      );
    }

    if (!isAllowedStatusReason(status, reasonCode)) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "INVALID_STATUS_REASON",
            message: "指定された状態変更理由は、この操作では使用できません。"
          }
        },
        400
      );
    }

    if (reasonCode === STATUS_REASON_CODES.OTHER && !reasonComment) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "STATUS_REASON_COMMENT_REQUIRED",
            message: "理由で「その他」を選択した場合は、内容を入力してください。"
          }
        },
        400
      );
    }

    if (reasonCode !== STATUS_REASON_CODES.OTHER && reasonComment) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "STATUS_REASON_COMMENT_NOT_ALLOWED",
            message: "理由コメントは「その他」を選択した場合のみ指定できます。"
          }
        },
        400
      );
    }
  }

  const now = new Date().toISOString();
  const auditRepository = new AdminAuditLogRepository(env.DB);

  if (before.status !== status) {
    if (status === "active") {
      const normalizedEmail = typeof before.normalized_email === "string"
        ? before.normalized_email.trim()
        : "";

      if (!normalizedEmail) {
        return jsonResponse(
          {
            success: false,
            request_id: requestId,
            error: {
              code: "LICENSE_EMAIL_MISSING",
              message: "このライセンスにはメールアドレス情報がないため、有効化できません。"
            }
          },
          400
        );
      }

      const conflictingLicense = await repository.findOtherActiveByNormalizedEmailAndEdition(
        normalizedEmail,
        before.edition,
        licenseId
      );

      if (conflictingLicense) {
        await auditRepository.insert({
          requestId,
          licenseId,
          action: "LICENSE_ACTIVATION_REJECTED",
          beforeValue: { status: before.status },
          afterValue: { status: before.status },
          note: buildAuditNote(reasonCode, reasonComment, {
            rejection_code: "ACTIVE_LICENSE_ALREADY_EXISTS",
            conflicting_license_id: Number(conflictingLicense.id)
          }),
          ipAddress: getClientIp(request),
          userAgent: getUserAgent(request),
          createdAt: now
        });
        return buildConflictResponse(requestId, conflictingLicense);
      }
    }

    let changes;
    try {
      changes = await repository.updateAdminStatus(licenseId, status, now);
    } catch (error) {
      if (status === "active" && isActiveEmailUniqueConstraintError(error)) {
        const conflictingLicense = await repository.findOtherActiveByNormalizedEmailAndEdition(
          before.normalized_email,
          before.edition,
          licenseId
        );
        if (conflictingLicense) {
          await auditRepository.insert({
            requestId,
            licenseId,
            action: "LICENSE_ACTIVATION_REJECTED",
            beforeValue: { status: before.status },
            afterValue: { status: before.status },
            note: buildAuditNote(reasonCode, reasonComment, {
              rejection_code: "ACTIVE_LICENSE_ALREADY_EXISTS",
              conflicting_license_id: Number(conflictingLicense.id),
              concurrent_update: true
            }),
            ipAddress: getClientIp(request),
            userAgent: getUserAgent(request),
            createdAt: now
          });
          return buildConflictResponse(requestId, conflictingLicense);
        }
      }
      throw error;
    }

    if (changes === 0) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "LICENSE_STATUS_UPDATE_FAILED",
            message: "ライセンス状態を更新できませんでした。"
          }
        },
        500
      );
    }
    await auditRepository.insert({
      requestId,
      licenseId,
      action: "LICENSE_STATUS_UPDATE",
      beforeValue: { status: before.status },
      afterValue: { status },
      note: buildAuditNote(reasonCode, reasonComment),
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
      createdAt: now
    });
  }
  const after = await repository.findAdminById(licenseId);
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      id: Number(after.id),
      status: after.status,
      updated_at: after.updated_at
    }
  });
}
