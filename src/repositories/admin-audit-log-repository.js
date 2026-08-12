export class AdminAuditLogRepository {
  constructor(db) {
    this.db = db;
  }
  db;
  async insert(input) {
    const result = await this.db.prepare(
      `
          INSERT INTO admin_audit_logs (
            request_id,
            license_id,
            app_id,
            action,
            before_value,
            after_value,
            note,
            ip_address,
            user_agent,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).bind(
      input.requestId,
      input.licenseId,
      input.appId ?? null,
      input.action,
      input.beforeValue == null ? null : JSON.stringify(input.beforeValue),
      input.afterValue == null ? null : JSON.stringify(input.afterValue),
      input.note,
      input.ipAddress,
      input.userAgent,
      input.createdAt
    ).run();
    if (!result.success) {
      throw new Error("Failed to insert admin audit log.");
    }
  }
};
