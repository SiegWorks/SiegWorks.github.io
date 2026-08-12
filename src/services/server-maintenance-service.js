import { SettingsRepository } from "../repositories/settings-repository.js";
import { createRequestId, jsonResponse } from "../utils/http.js";
export async function getServerMaintenance(env) {
  const requestId = createRequestId();
  if (!env.DB) return jsonResponse({ success:false, requestId, errorCode:"SERVER_CONFIGURATION_ERROR", message:"サーバー設定が完了していません。" },500);
  const settings = await new SettingsRepository(env.DB).getServerMaintenanceSettings();
  return jsonResponse({ success:true, maintenanceMode:settings.maintenanceMode, maintenanceMessage:settings.maintenanceMessage });
}
