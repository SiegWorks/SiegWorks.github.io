export class AppVersionRepository {
  constructor(db) {
    this.db = db;
  }

  async findActiveByAppIdAndChannel(appId, channel) {
    return await this.db.prepare(
      `
        SELECT
          a.app_id,
          a.display_name,
          v.channel,
          v.latest_version,
          v.minimum_version,
          v.download_url,
          v.release_notes,
          v.maintenance_mode,
          v.maintenance_message,
          v.published_at
        FROM applications a
        INNER JOIN app_versions v
          ON v.app_id = a.app_id
        WHERE a.app_id = ?
          AND a.is_active = 1
          AND v.channel = ?
        LIMIT 1
      `
    ).bind(appId, channel).first();
  }

  async findByAppIdAndChannel(appId, channel) {
    return await this.db.prepare(
      `
        SELECT
          a.app_id,
          a.display_name,
          a.is_active,
          v.channel,
          v.latest_version,
          v.minimum_version,
          v.download_url,
          v.release_notes,
          v.maintenance_mode,
          v.maintenance_message,
          v.published_at,
          v.created_at,
          v.updated_at
        FROM applications a
        LEFT JOIN app_versions v
          ON v.app_id = a.app_id
         AND v.channel = ?
        WHERE a.app_id = ?
        LIMIT 1
      `
    ).bind(channel, appId).first();
  }

  async upsert(input) {
    const result = await this.db.prepare(
      `
        INSERT INTO app_versions (
          app_id,
          channel,
          latest_version,
          minimum_version,
          download_url,
          release_notes,
          maintenance_mode,
          maintenance_message,
          published_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_id, channel) DO UPDATE SET
          latest_version = excluded.latest_version,
          minimum_version = excluded.minimum_version,
          download_url = excluded.download_url,
          release_notes = excluded.release_notes,
          maintenance_mode = excluded.maintenance_mode,
          maintenance_message = excluded.maintenance_message,
          published_at = excluded.published_at,
          updated_at = excluded.updated_at
      `
    ).bind(
      input.appId,
      input.channel,
      input.latestVersion,
      input.minimumVersion,
      input.downloadUrl,
      input.releaseNotes,
      input.maintenanceMode ? 1 : 0,
      input.maintenanceMessage,
      input.publishedAt,
      input.updatedAt
    ).run();

    if (!result.success) {
      throw new Error("Failed to upsert app version settings.");
    }
  }
}
