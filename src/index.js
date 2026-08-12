import { API_VERSION } from "./config/constants.js";
import { handleAdminRoute } from "./routes/admin.js";
import { handleDebugRoute, handleLicenseRoute } from "./routes/license.js";
import { handleStripeRoute } from "./routes/stripe.js";
import { getVersionInfo } from "./services/version-service.js";
import { getAppVersionInfo } from "./services/app-version-service.js";
import { getServerMaintenance } from "./services/server-maintenance-service.js";
import { cleanupExpiredLicenseKeys } from "./services/license-key-cleanup-service.js";
import { createRequestId, jsonResponse } from "./utils/http.js";

const worker = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return jsonResponse({
          success: true,
          service: "Voicon License API",
          apiVersion: API_VERSION
        });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/version") {
        return await getVersionInfo(env);
      }

      if (request.method === "GET" && url.pathname === "/api/v1/system/maintenance") return await getServerMaintenance(env);

      const appVersionMatch = url.pathname.match(/^\/api\/v1\/apps\/([^/]+)\/version$/);
      if (request.method === "GET" && appVersionMatch) {
        let appId;
        try {
          appId = decodeURIComponent(appVersionMatch[1]);
        } catch {
          const requestId = createRequestId();
          return jsonResponse({
            success: false,
            requestId,
            errorCode: "INVALID_APP_ID",
            message: "アプリIDの形式が正しくありません。"
          }, 400);
        }
        return await getAppVersionInfo(env, appId);
      }

      const adminResponse = await handleAdminRoute(request, env, url.pathname);
      if (adminResponse !== null) return adminResponse;

      const stripeResponse = await handleStripeRoute(request, env, url.pathname);
      if (stripeResponse !== null) return stripeResponse;

      const debugResponse = await handleDebugRoute(request, env, url.pathname);
      if (debugResponse !== null) return debugResponse;

      const licenseResponse = await handleLicenseRoute(request, env, url.pathname);
      if (licenseResponse !== null) return licenseResponse;

      const requestId = createRequestId();
      return jsonResponse({
        success: false,
        requestId,
        errorCode: "NOT_FOUND",
        message: "指定されたAPIは存在しません。"
      }, 404);
    } catch (error) {
      const requestId = createRequestId();
      console.error("Unhandled error:", requestId, error);
      return jsonResponse({
        success: false,
        requestId,
        errorCode: "SERVER_ERROR",
        message: "サーバー内部でエラーが発生しました。"
      }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      cleanupExpiredLicenseKeys(
        env,
        new Date(controller.scheduledTime).toISOString()
      )
    );
  }
};

export default worker;
