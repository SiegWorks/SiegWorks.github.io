import { getDebugLicenseContext, regenerateDebugOfflineToken } from "../services/debug-offline-token-service.js";
import { deactivateLicense } from "../services/license-deactivate-service.js";
import { verifyLicense } from "../services/license-verify-service.js";
import { issueTrialDictionaryKey } from "../services/dictionary-key-service.js";
import { jsonResponse } from "../utils/http.js";


export async function handleDebugRoute(request, env, pathname) {
  try {
    if (request.method === "POST" &&
        pathname === "/api/v1/debug/offline-token/context") {
      return await getDebugLicenseContext(request, env);
    }
    if (request.method === "POST" &&
        pathname === "/api/v1/debug/offline-token/regenerate") {
      return await regenerateDebugOfflineToken(request, env);
    }
    return null;
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("Unhandled debug API error:", requestId, request.method, pathname, error);
    return jsonResponse(
      {
        success: false,
        errorCode: "INTERNAL_ERROR",
        requestId,
        message: "デバッグ用APIの処理中にエラーが発生しました。"
      },
      500
    );
  }
}

export async function handleLicenseRoute(request, env, pathname) {
  if (request.method === "POST" && pathname === "/api/v1/license/verify") {
    return await verifyLicense(request, env);
  }
  if (request.method === "POST" && pathname === "/api/v1/dictionary/trial-key") {
    return await issueTrialDictionaryKey(request, env);
  }
  if (request.method === "POST" && pathname === "/api/v1/license/deactivate") {
    return await deactivateLicense(request, env);
  }
  return null;
}
