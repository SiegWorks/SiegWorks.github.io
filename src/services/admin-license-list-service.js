import { LicenseRepository } from "../repositories/license-repository.js";
import { jsonResponse } from "../utils/http.js";
import { normalizeLicenseKey } from "../utils/license-key.js";
import { createHmacSha256Hex } from "../utils/crypto.js";

export async function getAdminLicenseList(request, env) {
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
  const url = new URL(request.url);
  const pageText = url.searchParams.get("page") ?? "1";
  const pageSizeText = url.searchParams.get("pageSize") ?? "100";
  const page = Number.parseInt(pageText, 10);
  const pageSize = Number.parseInt(pageSizeText, 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_PAGINATION",
          message: "pageは1以上、pageSizeは1～100で指定してください。"
        }
      },
      400
    );
  }
  const customerName = (url.searchParams.get("customerName") ?? "").trim();
  const email = (url.searchParams.get("email") ?? "").trim();
  const licenseKeyInput = (url.searchParams.get("licenseKey") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const sort = (url.searchParams.get("sort") ?? "created_at").trim().toLowerCase();
  const order = (url.searchParams.get("order") ?? "desc").trim().toLowerCase();
  if (customerName.length > 200 || email.length > 320 || licenseKeyInput.length > 100) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_SEARCH_CONDITION",
          message: "検索条件が長すぎます。"
        }
      },
      400
    );
  }

  let licenseHash = "";
  if (licenseKeyInput !== "") {
    if (!env.LICENSE_HMAC_KEY) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "SERVER_CONFIGURATION_ERROR",
            message: "ライセンスキー検索に必要なサーバー設定がありません。"
          }
        },
        500
      );
    }

    const normalizedLicenseKey = normalizeLicenseKey(licenseKeyInput);
    if (normalizedLicenseKey === null) {
      return jsonResponse(
        {
          success: false,
          request_id: requestId,
          error: {
            code: "INVALID_LICENSE_KEY",
            message: "ライセンスキーの形式が正しくありません。"
          }
        },
        400
      );
    }

    licenseHash = await createHmacSha256Hex(normalizedLicenseKey, env.LICENSE_HMAC_KEY);
  }

  if (status !== "" && status !== "active" && status !== "suspended") {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_STATUS",
          message: "statusにはactiveまたはsuspendedを指定してください。"
        }
      },
      400
    );
  }
  const sortExpressions = {
    id: "l.id",
    customer_name: "l.customer_name",
    customer_email: "l.customer_email",
    status: "l.status",
    expires_at: "l.expires_at",
    device_count: "device_count",
    last_auth_at: "last_auth_at",
    created_at: "l.created_at"
  };
  const sortExpression = sortExpressions[sort];
  if (!sortExpression || (order !== "asc" && order !== "desc")) {
    return jsonResponse(
      {
        success: false,
        request_id: requestId,
        error: {
          code: "INVALID_SORT",
          message: "sortまたはorderの指定が正しくありません。"
        }
      },
      400
    );
  }
  const filters = { customerName, email, licenseHash, status };
  const repository = new LicenseRepository(env.DB);
  const totalCount = await repository.getAdminCount(filters);
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const offset = (page - 1) * pageSize;
  const rows = await repository.getAdminList(pageSize, offset, filters, sortExpression, order.toUpperCase());
  return jsonResponse({
    success: true,
    request_id: requestId,
    data: {
      items: rows.map((row) => ({
        id: Number(row.id),
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        edition: row.edition,
        status: row.status,
        expires_at: row.expires_at,
        has_memo: typeof row.memo === "string" && row.memo.trim() !== "",
        device_count: Number(row.device_count ?? 0),
        last_auth_at: row.last_auth_at,
        created_at: row.created_at
      })),
      page,
      page_size: pageSize,
      total_count: totalCount,
      total_pages: totalPages
    }
  });
}
