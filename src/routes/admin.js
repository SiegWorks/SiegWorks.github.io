import { getAdminApplications, createAdminApplication, updateAdminApplication } from "../services/admin-application-service.js";
import { getAdminAppList, getAdminAppVersion, updateAdminAppVersion } from "../services/admin-app-version-service.js";
import { getAdminAuthLogList } from "../services/admin-auth-log-list-service.js";
import { deactivateAdminDevice } from "../services/admin-device-deactivate-service.js";
import { getAdminDeviceList } from "../services/admin-device-list-service.js";
import { getAdminLicenseDetail } from "../services/admin-license-detail-service.js";
import { getAdminLicenseList } from "../services/admin-license-list-service.js";
import { createLicense } from "../services/admin-license-service.js";
import { reissueAdminLicenseKey } from "../services/admin-license-reissue-service.js";
import { updateAdminLicenseStatus } from "../services/admin-license-status-service.js";
import { updateAdminLicense } from "../services/admin-license-update-service.js";
import { getAdminVersionSettings, updateAdminVersionSettings } from "../services/admin-version-service.js";
import { getAdminServerMaintenance, updateAdminServerMaintenance } from "../services/admin-server-maintenance-service.js";
import { adminErrorResponse, createRequestId } from "../utils/http.js";

export async function handleAdminRoute(request, env, pathname) {
  try {
    if (pathname === "/api/v1/admin/applications" && request.method === "GET") return await getAdminApplications(request, env);
    if (pathname === "/api/v1/admin/applications" && request.method === "POST") return await createAdminApplication(request, env);
    const applicationMatch = pathname.match(/^\/api\/v1\/admin\/applications\/([^/]+)$/);
    if (applicationMatch && request.method === "PUT") return await updateAdminApplication(request, env, applicationMatch[1]);
    if (request.method === "GET" && pathname === "/api/v1/admin/apps") {
      return await getAdminAppList(request, env);
    }
    const appVersionMatch = pathname.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/version$/);
    if (request.method === "GET" && appVersionMatch) {
      return await getAdminAppVersion(request, env, appVersionMatch[1]);
    }
    if (request.method === "PUT" && appVersionMatch) {
      return await updateAdminAppVersion(request, env, appVersionMatch[1]);
    }
    if (request.method === "GET" && pathname === "/api/v1/admin/system-maintenance") return await getAdminServerMaintenance(request, env);
    if (request.method === "PUT" && pathname === "/api/v1/admin/system-maintenance") return await updateAdminServerMaintenance(request, env);
    if (request.method === "GET" &&
        pathname === "/api/v1/admin/system-settings") {
      return await getAdminVersionSettings(request, env);
    }
    if (request.method === "PUT" &&
        pathname === "/api/v1/admin/system-settings") {
      return await updateAdminVersionSettings(request, env);
    }
    if (request.method === "GET" && pathname === "/api/v1/admin/licenses") {
      return await getAdminLicenseList(request, env);
    }
    const authLogsMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)\/authlogs$/);
    if (request.method === "GET" && authLogsMatch) {
      return await getAdminAuthLogList(request, env, authLogsMatch[1]);
    }
    const deviceDeactivateMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)\/devices\/([^/]+)$/);
    if (request.method === "DELETE" && deviceDeactivateMatch) {
      return await deactivateAdminDevice(
        request,
        env,
        deviceDeactivateMatch[1],
        deviceDeactivateMatch[2]
      );
    }
    const devicesMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)\/devices$/);
    if (request.method === "GET" && devicesMatch) {
      return await getAdminDeviceList(request, env, devicesMatch[1]);
    }
    const statusMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)\/status$/);
    if (request.method === "PUT" && statusMatch) {
      return await updateAdminLicenseStatus(request, env, statusMatch[1]);
    }
    const reissueMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)\/reissue-key$/);
    if (request.method === "POST" && reissueMatch) {
      return await reissueAdminLicenseKey(request, env, reissueMatch[1]);
    }
    const detailMatch = pathname.match(/^\/api\/v1\/admin\/licenses\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      return await getAdminLicenseDetail(request, env, detailMatch[1]);
    }
    if (request.method === "PUT" && detailMatch) {
      return await updateAdminLicense(request, env, detailMatch[1]);
    }
    const isCreateRoute = request.method === "POST" && (pathname === "/api/v1/admin/licenses" || pathname === "/api/admin/license/create");
    if (isCreateRoute) {
      return await createLicense(request, env);
    }
    return null;
  } catch (error) {
    const requestId = createRequestId();
    console.error("Unhandled admin API error:", requestId, request.method, pathname, error);
    return adminErrorResponse(
      requestId,
      "INTERNAL_ERROR",
      "管理APIの処理中にエラーが発生しました。",
      500
    );
  }
}
