const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 600;

export class StripeEventRepository {
  constructor(db) { this.db = db; }

  async acquireForProcessing(eventId, eventType, now, timeoutSeconds = DEFAULT_PROCESSING_TIMEOUT_SECONDS) {
    const insertResult = await this.db.prepare(`
      INSERT OR IGNORE INTO stripe_events (
        event_id, event_type, processing_status, error_message, received_at, processed_at
      ) VALUES (?, ?, 'processing', NULL, ?, NULL)
    `).bind(eventId, eventType, now).run();
    if (!insertResult.success) throw new Error("Failed to register Stripe event.");
    if (Number(insertResult.meta.changes ?? 0) === 1) return { acquired: true, status: "processing", isRetry: false };

    const staleBefore = new Date(new Date(now).getTime() - timeoutSeconds * 1000).toISOString();
    const retryResult = await this.db.prepare(`
      UPDATE stripe_events
      SET event_type = ?, processing_status = 'processing', error_message = NULL,
          received_at = ?, processed_at = NULL
      WHERE event_id = ?
        AND (processing_status = 'failed'
          OR (processing_status = 'processing' AND received_at < ?))
    `).bind(eventType, now, eventId, staleBefore).run();
    if (!retryResult.success) throw new Error("Failed to retry Stripe event.");
    if (Number(retryResult.meta.changes ?? 0) === 1) return { acquired: true, status: "processing", isRetry: true };

    const existing = await this.findById(eventId);
    return { acquired: false, status: existing?.processing_status ?? "unknown", isRetry: false };
  }

  async findById(eventId) {
    return await this.db.prepare(`
      SELECT event_id, event_type, processing_status, error_message, received_at, processed_at
      FROM stripe_events WHERE event_id = ? LIMIT 1
    `).bind(eventId).first();
  }

  async markCompleted(eventId, processedAt) {
    const result = await this.db.prepare(`
      UPDATE stripe_events SET processing_status = 'completed', error_message = NULL, processed_at = ?
      WHERE event_id = ? AND processing_status = 'processing'
    `).bind(processedAt, eventId).run();
    if (!result.success) throw new Error("Failed to complete Stripe event.");
    return Number(result.meta.changes ?? 0);
  }

  async markFailed(eventId, errorMessage, processedAt) {
    const result = await this.db.prepare(`
      UPDATE stripe_events SET processing_status = 'failed', error_message = ?, processed_at = ?
      WHERE event_id = ? AND processing_status = 'processing'
    `).bind(errorMessage, processedAt, eventId).run();
    if (!result.success) throw new Error("Failed to mark Stripe event as failed.");
    return Number(result.meta.changes ?? 0);
  }
}
