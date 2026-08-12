import { DEFAULT_CLOCK_TOLERANCE_SECONDS, DEFAULT_MINIMUM_VERSION, DEFAULT_OFFLINE_TOKEN_HOURS, DEFAULT_OFFLINE_TOKEN_KEY_ID } from "../config/constants.js";

export class SettingsRepository {
  constructor(db) {
    this.db = db;
  }
  db;
  async getLicenseServerSettings() {
    const result = await this.db.prepare(
      `
          SELECT setting_key, setting_value
          FROM settings
          WHERE setting_key IN (
            'maintenance_mode',
            'maintenance_message',
            'offline_token_hours',
            'clock_tolerance_seconds',
            'offline_token_key_id'
          )
        `
    ).all();
    const values = /* @__PURE__ */ new Map();
    for (const row of result.results ?? []) {
      values.set(row.setting_key, row.setting_value);
    }
    const offlineTokenHours = Number.parseInt(
      values.get("offline_token_hours") ?? String(DEFAULT_OFFLINE_TOKEN_HOURS),
      10
    );
    const clockToleranceSeconds = Number.parseInt(
      values.get("clock_tolerance_seconds") ?? String(DEFAULT_CLOCK_TOLERANCE_SECONDS),
      10
    );
    return {
      maintenanceMode: (values.get("maintenance_mode") ?? "false").toLowerCase() === "true",
      maintenanceMessage: values.get("maintenance_message") ?? "\u73FE\u5728\u3001\u30E9\u30A4\u30BB\u30F3\u30B9\u8A8D\u8A3C\u30B5\u30FC\u30D0\u30FC\u306F\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9\u4E2D\u3067\u3059\u3002",
      offlineTokenHours: Number.isFinite(offlineTokenHours) && offlineTokenHours > 0 ? offlineTokenHours : DEFAULT_OFFLINE_TOKEN_HOURS,
      clockToleranceSeconds: Number.isFinite(clockToleranceSeconds) && clockToleranceSeconds > 0 ? clockToleranceSeconds : DEFAULT_CLOCK_TOLERANCE_SECONDS,
      offlineTokenKeyId: values.get("offline_token_key_id") ?? DEFAULT_OFFLINE_TOKEN_KEY_ID
    };
  }

  async getServerMaintenanceSettings() {
    const result = await this.db.prepare(`SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('maintenance_mode','maintenance_message')`).all();
    const values = new Map();
    for (const row of result.results ?? []) values.set(row.setting_key, row.setting_value);
    return { maintenanceMode: (values.get("maintenance_mode") ?? "false").toLowerCase() === "true", maintenanceMessage: values.get("maintenance_message") ?? "現在、サーバーはメンテナンス中です。しばらくしてから再度お試しください。" };
  }
  async updateServerMaintenanceSettings(input) {
    await this.setValue("maintenance_mode", input.maintenanceMode ? "true" : "false");
    await this.setValue("maintenance_message", input.maintenanceMessage);
  }
  async getLegacyVersionSettings() {
    const result = await this.db.prepare(
      `
          SELECT setting_key, setting_value
          FROM settings
          WHERE setting_key IN (
            'minimum_version',
            'maintenance_mode',
            'maintenance_message',
            'latest_version',
            'download_url',
            'release_notes'
          )
        `
    ).all();
    const values = new Map();
    for (const row of result.results ?? []) {
      values.set(row.setting_key, row.setting_value);
    }
    return {
      minimumVersion: values.get("minimum_version") ?? DEFAULT_MINIMUM_VERSION,
      latestVersion: values.get("latest_version") ?? DEFAULT_MINIMUM_VERSION,
      downloadUrl: values.get("download_url") ?? "",
      releaseNotes: values.get("release_notes") ?? "",
      maintenanceMode: (values.get("maintenance_mode") ?? "false").toLowerCase() === "true",
      maintenanceMessage: values.get("maintenance_message") ?? "現在、ライセンス認証サーバーはメンテナンス中です。"
    };
  }
  async setValue(key, value) {
    const result = await this.db.prepare(
      `
          INSERT INTO settings (setting_key, setting_value)
          VALUES (?, ?)
          ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value
        `
    ).bind(key, value).run();
    if (!result.success) {
      throw new Error("Failed to update setting.");
    }
  }
  async updateVersionSettings(input) {
    await this.setValue("latest_version", input.latestVersion);
    await this.setValue("minimum_version", input.minimumVersion);
    await this.setValue("download_url", input.downloadUrl);
    await this.setValue("release_notes", input.releaseNotes);
    await this.setValue("maintenance_mode", input.maintenanceMode ? "true" : "false");
    await this.setValue("maintenance_message", input.maintenanceMessage);
  }
};
