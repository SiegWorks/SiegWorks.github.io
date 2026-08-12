export class ApplicationRepository {
  constructor(db) {
    this.db = db;
  }

  async listAll() {
    const result = await this.db.prepare(`
      SELECT app_id, display_name, is_active, created_at, updated_at
      FROM applications
      ORDER BY display_name COLLATE NOCASE, app_id
    `).all();
    return result.results ?? [];
  }

  async insert(input) {
    const result = await this.db.prepare(`
      INSERT INTO applications (app_id, display_name, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(input.appId, input.displayName, input.isActive ? 1 : 0, input.createdAt, input.updatedAt).run();
    if (!result.success) throw new Error("Failed to insert application.");
  }

  async update(input) {
    const result = await this.db.prepare(`
      UPDATE applications SET display_name = ?, is_active = ?, updated_at = ? WHERE app_id = ?
    `).bind(input.displayName, input.isActive ? 1 : 0, input.updatedAt, input.appId).run();
    if (!result.success) throw new Error("Failed to update application.");
  }

  async listActive() {
    const result = await this.db.prepare(
      `
        SELECT
          app_id,
          display_name,
          is_active,
          created_at,
          updated_at
        FROM applications
        WHERE is_active = 1
        ORDER BY display_name COLLATE NOCASE, app_id
      `
    ).all();

    return result.results ?? [];
  }

  async findByAppId(appId) {
    return await this.db.prepare(
      `
        SELECT
          app_id,
          display_name,
          is_active,
          created_at,
          updated_at
        FROM applications
        WHERE app_id = ?
        LIMIT 1
      `
    ).bind(appId).first();
  }
}
