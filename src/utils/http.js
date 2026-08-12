import { JSON_HEADERS } from "../config/constants.js";

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}
export function createRequestId() {
  return crypto.randomUUID();
}
export function adminSuccessResponse(requestId, data, status = 200, legacyFields = null) {
  return jsonResponse(
    {
      success: true,
      request_id: requestId,
      data,
      ...(legacyFields ?? {})
    },
    status
  );
}
export function adminErrorResponse(requestId, code, message, status, details = null, includeLegacyFields = false) {
  const response = {
    success: false,
    request_id: requestId,
    error: {
      code,
      message,
      ...(details == null ? {} : { details })
    }
  };
  if (includeLegacyFields) {
    response.errorCode = code;
    response.message = message;
  }
  return jsonResponse(response, status);
}
export function isAdminAuthorized(request, env) {
  if (!env.ADMIN_API_KEY) {
    return false;
  }
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization === `Bearer ${env.ADMIN_API_KEY}`;
}
export function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP");
}
export function getUserAgent(request) {
  const value = request.headers.get("User-Agent");
  return value && value.trim() !== "" ? value : null;
}
