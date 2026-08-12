export class DeviceReleaseMarkerRepository {
  constructor(db) {
    this.db = db;
  }

  db;

  async find(licenseId, deviceHash) {
    return await this.db.prepare(
      `
        SELECT license_id, device_hash, released_at, released_by
        FROM device_release_markers
        WHERE license_id = ? AND device_hash = ?
        LIMIT 1
      `
    ).bind(licenseId, deviceHash).first();
  }

  async upsert(input) {
    const result = await this.db.prepare(
      `
        INSERT INTO device_release_markers (
          license_id,
          device_hash,
          released_at,
          released_by
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(license_id, device_hash) DO UPDATE SET
          released_at = excluded.released_at,
          released_by = excluded.released_by
      `
    ).bind(
      input.licenseId,
      input.deviceHash,
      input.releasedAt,
      input.releasedBy ?? "manager"
    ).run();

    if (!result.success) {
      throw new Error("Failed to save device release marker.");
    }
  }

  async releaseDevice(input) {
    const deleteDevice = this.db.prepare(
      `
        DELETE FROM devices
        WHERE id = ? AND license_id = ?
      `
    ).bind(input.deviceId, input.licenseId);

    const saveMarker = this.db.prepare(
      `
        INSERT INTO device_release_markers (
          license_id,
          device_hash,
          released_at,
          released_by
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(license_id, device_hash) DO UPDATE SET
          released_at = excluded.released_at,
          released_by = excluded.released_by
      `
    ).bind(
      input.licenseId,
      input.deviceHash,
      input.releasedAt,
      input.releasedBy ?? "manager"
    );

    const results = await this.db.batch([deleteDevice, saveMarker]);
    const deleteResult = results[0];
    if (!deleteResult?.success || Number(deleteResult.meta?.changes ?? 0) === 0) {
      throw new Error("Failed to release device registration.");
    }
  }

  async delete(licenseId, deviceHash) {
    const result = await this.db.prepare(
      `
        DELETE FROM device_release_markers
        WHERE license_id = ? AND device_hash = ?
      `
    ).bind(licenseId, deviceHash).run();

    if (!result.success) {
      throw new Error("Failed to delete device release marker.");
    }
  }
}
