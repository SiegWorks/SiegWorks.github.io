export class DeviceRepository {
  constructor(db) {
    this.db = db;
  }
  db;
  async findByLicenseId(licenseId) {
    return await this.db.prepare(
      `
          SELECT
            id,
            license_id,
            device_hash,
            registered_at,
            last_auth_at,
            last_client_time_utc,
            last_clock_difference_seconds,
            last_app_version,
            last_os_version
          FROM devices
          WHERE license_id = ?
          LIMIT 1
        `
    ).bind(licenseId).first();
  }
  async findAllByLicenseId(licenseId) {
    const result = await this.db.prepare(
      `
          SELECT
            id,
            license_id,
            device_hash,
            registered_at,
            last_auth_at,
            last_client_time_utc,
            last_clock_difference_seconds,
            last_app_version,
            last_os_version
          FROM devices
          WHERE license_id = ?
          ORDER BY registered_at DESC
        `
    ).bind(licenseId).all();

    return result.results ?? [];
  }
  async register(input) {
    const result = await this.db.prepare(
      `
          INSERT INTO devices (
            license_id,
            device_hash,
            registered_at,
            last_auth_at,
            last_client_time_utc,
            last_clock_difference_seconds,
            last_app_version,
            last_os_version
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).bind(
      input.licenseId,
      input.deviceHash,
      input.now,
      input.now,
      input.clientTimeUtc,
      input.clockDifferenceSeconds,
      input.appVersion,
      input.osVersion
    ).run();
    if (!result.success) {
      throw new Error("Failed to register device.");
    }
  }
  async updateLastAuthentication(input) {
    const result = await this.db.prepare(
      `
          UPDATE devices
          SET
            last_auth_at = ?,
            last_client_time_utc = ?,
            last_clock_difference_seconds = ?,
            last_app_version = ?,
            last_os_version = ?
          WHERE license_id = ?
        `
    ).bind(
      input.now,
      input.clientTimeUtc,
      input.clockDifferenceSeconds,
      input.appVersion,
      input.osVersion,
      input.licenseId
    ).run();
    if (!result.success) {
      throw new Error("Failed to update device authentication.");
    }
  }
  async findByIdAndLicenseId(deviceId, licenseId) {
    return await this.db.prepare(
      `
          SELECT
            id,
            license_id,
            device_hash,
            registered_at,
            last_auth_at,
            last_client_time_utc,
            last_clock_difference_seconds,
            last_app_version,
            last_os_version
          FROM devices
          WHERE id = ? AND license_id = ?
          LIMIT 1
        `
    ).bind(deviceId, licenseId).first();
  }
  async deleteByIdAndLicenseId(deviceId, licenseId) {
    const result = await this.db.prepare(
      `
          DELETE FROM devices
          WHERE id = ? AND license_id = ?
        `
    ).bind(deviceId, licenseId).run();
    if (!result.success) {
      throw new Error("Failed to delete device.");
    }
    return Number(result.meta.changes ?? 0);
  }
  async updateDebugLastAuthAt(deviceId, licenseId, lastAuthAt) {
    const result = await this.db.prepare(
      `
          UPDATE devices
          SET
            last_auth_at = ?
          WHERE id = ? AND license_id = ?
        `
    ).bind(lastAuthAt, deviceId, licenseId).run();
    if (!result.success) {
      throw new Error("Failed to update debug device last authentication.");
    }
    return Number(result.meta.changes ?? 0);
  }

  async deleteByLicenseId(licenseId) {
    const result = await this.db.prepare(
      `
          DELETE FROM devices
          WHERE license_id = ?
        `
    ).bind(licenseId).run();
    if (!result.success) {
      throw new Error("Failed to delete device.");
    }
  }
};
