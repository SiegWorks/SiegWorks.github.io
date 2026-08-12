import { AdminAuditLogRepository } from "../repositories/admin-audit-log-repository.js";
import { LicenseRepository } from "../repositories/license-repository.js";
import { getClientIp, getUserAgent, jsonResponse } from "../utils/http.js";

export async function updateAdminLicense(request, env, licenseIdText) {
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
  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  if (customerName.length === 0) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "CUSTOMER_NAME_REQUIRED",
          message: "顧客名を入力してください。"
        }
      },
      400
    );
  }
  if (customerName.length > 200) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "CUSTOMER_NAME_TOO_LONG",
          message: "顧客名が長すぎます。"
        }
      },
      400
    );
  }
  const customerEmail = typeof body.customer_email === "string" && body.customer_email.trim() !== "" ? body.customer_email.trim() : null;
  if (customerEmail !== null && customerEmail.length > 320) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "CUSTOMER_EMAIL_TOO_LONG",
          message: "メールアドレスが長すぎます。"
        }
      },
      400
    );
  }
  if (typeof body.expires_at !== "string" || body.expires_at.trim() === "") {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "EXPIRES_AT_REQUIRED",
          message: "有効期限を入力してください。"
        }
      },
      400
    );
  }
  const parsedExpiresAt = new Date(body.expires_at);
  if (Number.isNaN(parsedExpiresAt.getTime())) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_EXPIRES_AT",
          message: "有効期限の形式が正しくありません。"
        }
      },
      400
    );
  }
  const expiresAt = parsedExpiresAt.toISOString();
  const memo = typeof body.memo === "string" && body.memo.trim() !== "" ? body.memo.trim() : null;
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
  const now = new Date().toISOString();
  const changes = await repository.updateAdmin(licenseId, {
    customerName,
    customerEmail,
    expiresAt,
    memo,
    now
  });
  if (changes === 0) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "LICENSE_UPDATE_FAILED",
          message: "ライセンス情報を更新できませんでした。"
        }
      },
      500
    );
  }
  const after = await repository.findAdminById(licenseId);
  await new AdminAuditLogRepository(env.DB).insert({
    requestId,
    licenseId,
    action: "LICENSE_UPDATE",
    beforeValue: {
      customer_name: before.customer_name,
      customer_email: before.customer_email,
      expires_at: before.expires_at,
      memo: before.memo
    },
    afterValue: {
      customer_name: customerName,
      customer_email: customerEmail,
      expires_at: expiresAt,
      memo
    },
    note: "Voicon License Managerからライセンス情報を更新",
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    createdAt: now
  });
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      id: Number(after.id),
      customer_name: after.customer_name,
      customer_email: after.customer_email,
      edition: after.edition,
      channel: after.channel,
      status: after.status,
      expires_at: after.expires_at,
      memo: after.memo,
      device_count: Number(after.device_count ?? 0),
      last_auth_at: after.last_auth_at,
      created_at: after.created_at,
      updated_at: after.updated_at
    }
  });
}
