export class LicenseRepository {
  constructor(db) { this.db = db; }

  async findByHash(licenseHash) {
    return await this.db.prepare(`
      SELECT id, customer_name, customer_email, normalized_email, edition, channel,
             status, expires_at, is_lifetime, memo, created_at, updated_at
      FROM licenses WHERE license_hash = ? LIMIT 1
    `).bind(licenseHash).first();
  }

  async findById(licenseId) {
    return await this.db.prepare(`
      SELECT id, customer_name, customer_email, normalized_email, edition, channel,
             status, expires_at, is_lifetime, memo, created_at, updated_at
      FROM licenses WHERE id = ? LIMIT 1
    `).bind(licenseId).first();
  }

  async findActiveByNormalizedEmailAndEdition(normalizedEmail, edition) {
    return await this.db.prepare(`
      SELECT id, customer_name, customer_email, normalized_email, edition, channel,
             status, expires_at, is_lifetime, memo, created_at, updated_at
      FROM licenses
      WHERE normalized_email = ? AND edition = ? AND status = 'active'
      LIMIT 1
    `).bind(normalizedEmail, edition).first();
  }

  async findOtherActiveByNormalizedEmailAndEdition(normalizedEmail, edition, excludedLicenseId) {
    return await this.db.prepare(`
      SELECT id, customer_name, customer_email, normalized_email, edition, channel,
             status, expires_at, is_lifetime, memo, created_at, updated_at
      FROM licenses
      WHERE normalized_email = ? AND edition = ? AND status = 'active' AND id <> ?
      LIMIT 1
    `).bind(normalizedEmail, edition, excludedLicenseId).first();
  }

  async insert(input) {
    const result = await this.db.prepare(`
      INSERT INTO licenses (
        license_hash, customer_name, customer_email, normalized_email,
        edition, channel, status, expires_at, is_lifetime, memo, created_at, updated_at
      ) VALUES (?, ?, ?, LOWER(TRIM(?)), ?, ?, 'active', ?, ?, ?, ?, ?)
    `).bind(
      input.licenseHash, input.customerName, input.customerEmail, input.customerEmail,
      input.edition, input.channel, input.expiresAt, input.isLifetime ? 1 : 0,
      input.memo, input.now, input.now
    ).run();
    if (!result.success || result.meta.last_row_id == null) throw new Error("Failed to insert license.");
    return Number(result.meta.last_row_id);
  }

  async extendActiveLicense(licenseId, input) {
    const result = await this.db.prepare(`
      UPDATE licenses
      SET customer_name = ?, customer_email = ?, normalized_email = LOWER(TRIM(?)),
          expires_at = ?, is_lifetime = 0, updated_at = ?
      WHERE id = ? AND status = 'active' AND is_lifetime = 0
    `).bind(
      input.customerName,
      input.customerEmail,
      input.customerEmail,
      input.expiresAt,
      input.now,
      licenseId
    ).run();
    if (!result.success) throw new Error("Failed to extend active license.");
    return Number(result.meta.changes ?? 0);
  }

  async findAdminById(licenseId) {
    return await this.db.prepare(`
      SELECT l.id, l.customer_name, l.customer_email, l.normalized_email, l.edition,
             l.channel, l.status, l.expires_at, l.memo, l.created_at, l.updated_at,
             COUNT(d.id) AS device_count, MAX(d.last_auth_at) AS last_auth_at
      FROM licenses AS l
      LEFT JOIN devices AS d ON d.license_id = l.id
      WHERE l.id = ?
      GROUP BY l.id, l.customer_name, l.customer_email, l.normalized_email, l.edition,
               l.channel, l.status, l.expires_at, l.memo, l.created_at, l.updated_at
      LIMIT 1
    `).bind(licenseId).first();
  }

  async updateAdmin(licenseId, input) {
    const result = await this.db.prepare(`
      UPDATE licenses
      SET customer_name = ?, customer_email = ?, normalized_email = LOWER(TRIM(?)),
          expires_at = ?, memo = ?, is_lifetime = 0, updated_at = ?
      WHERE id = ?
    `).bind(input.customerName, input.customerEmail, input.customerEmail, input.expiresAt, input.memo, input.now, licenseId).run();
    if (!result.success) throw new Error("Failed to update license.");
    return Number(result.meta.changes ?? 0);
  }

  async updateAdminStatus(licenseId, status, now) {
    const result = await this.db.prepare(`UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, licenseId).run();
    if (!result.success) throw new Error("Failed to update license status.");
    return Number(result.meta.changes ?? 0);
  }

  async rotateLicenseHash(licenseId, licenseHash, now) {
    const result = await this.db.prepare(`
      UPDATE licenses
      SET license_hash = ?, updated_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(licenseHash, now, licenseId).run();
    if (!result.success) throw new Error("Failed to rotate license hash.");
    return Number(result.meta.changes ?? 0);
  }

  async updateDebugExpiresAt(licenseId, expiresAt, now) {
    const result = await this.db.prepare(`UPDATE licenses SET expires_at = ?, is_lifetime = 0, updated_at = ? WHERE id = ?`).bind(expiresAt, now, licenseId).run();
    if (!result.success) throw new Error("Failed to update debug license expiration.");
    return Number(result.meta.changes ?? 0);
  }

  buildAdminWhere(filters) {
    const clauses = [];
    const values = [];
    if (filters.customerName) { clauses.push("l.customer_name LIKE ? COLLATE NOCASE"); values.push(`%${filters.customerName}%`); }
    if (filters.email) { clauses.push("COALESCE(l.customer_email, '') LIKE ? COLLATE NOCASE"); values.push(`%${filters.email}%`); }
    if (filters.licenseHash) { clauses.push("l.license_hash = ?"); values.push(filters.licenseHash); }
    if (filters.status) { clauses.push("l.status = ?"); values.push(filters.status); }
    return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "", values };
  }

  async getAdminList(limit, offset, filters, sortExpression, sortOrder) {
    const where = this.buildAdminWhere(filters);
    const result = await this.db.prepare(`
      SELECT l.id, l.customer_name, l.customer_email, l.normalized_email, l.edition, l.status,
             l.expires_at, l.memo, l.created_at, COUNT(d.id) AS device_count,
             MAX(d.last_auth_at) AS last_auth_at
      FROM licenses AS l LEFT JOIN devices AS d ON d.license_id = l.id
      ${where.sql}
      GROUP BY l.id, l.customer_name, l.customer_email, l.normalized_email, l.edition,
               l.status, l.expires_at, l.memo, l.created_at
      ORDER BY ${sortExpression} ${sortOrder}, l.id DESC
      LIMIT ? OFFSET ?
    `).bind(...where.values, limit, offset).all();
    return result.results ?? [];
  }

  async getAdminCount(filters) {
    const where = this.buildAdminWhere(filters);
    const row = await this.db.prepare(`SELECT COUNT(*) AS total_count FROM licenses AS l ${where.sql}`).bind(...where.values).first();
    return Number(row?.total_count ?? 0);
  }
}
