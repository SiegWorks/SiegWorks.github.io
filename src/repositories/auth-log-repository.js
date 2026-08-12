export class AuthLogRepository {
  constructor(db) {
    this.db = db;
  }
  db;
  async insert(input) {
    const result = await this.db.prepare(
      `
          INSERT INTO auth_logs (
            request_id,
            license_id,
            device_hash,
            auth_result,
            error_code,
            client_time_utc,
            server_time_utc,
            clock_difference_seconds,
            app_version,
            os_version,
            ip_address,
            user_agent,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).bind(
      input.requestId,
      input.licenseId,
      input.deviceHash,
      input.authResult,
      input.errorCode,
      input.clientTimeUtc,
      input.serverTimeUtc,
      input.clockDifferenceSeconds,
      input.appVersion,
      input.osVersion,
      input.ipAddress,
      input.userAgent,
      input.serverTimeUtc
    ).run();
    if (!result.success) {
      throw new Error("Failed to insert authentication log.");
    }
  }
  async getAdminListByLicenseId(licenseId, limit, offset) {
    const result = await this.db.prepare(
      `
          SELECT
            id,
            license_id,
            device_hash,
            auth_result,
            error_code,
            client_time_utc,
            server_time_utc,
            clock_difference_seconds,
            app_version,
            os_version,
            ip_address,
            user_agent,
            created_at,
            request_id
          FROM auth_logs
          WHERE license_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?
        `
    ).bind(licenseId, limit, offset).all();
    return result.results ?? [];
  }
  async getAdminCountByLicenseId(licenseId) {
    const row = await this.db.prepare(
      `
          SELECT COUNT(*) AS total_count
          FROM auth_logs
          WHERE license_id = ?
        `
    ).bind(licenseId).first();
    return Number(row?.total_count ?? 0);
  }
};
