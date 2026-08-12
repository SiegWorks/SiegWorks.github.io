const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 600;

export class StripeOrderRepository {
  constructor(db) { this.db = db; }

  async findByCheckoutSessionId(checkoutSessionId) {
    return await this.db.prepare(`
      SELECT id, stripe_event_id, checkout_session_id, payment_intent_id, price_id,
             customer_email, normalized_email, license_days, amount_total, currency,
             license_id, fulfillment_action, processing_status, error_message,
             license_key_ciphertext, license_key_iv, license_key_expires_at,
             created_at, completed_at
      FROM stripe_orders WHERE checkout_session_id = ? LIMIT 1
    `).bind(checkoutSessionId).first();
  }

  async findByStripeEventId(stripeEventId) {
    return await this.db.prepare(`
      SELECT id, stripe_event_id, checkout_session_id, payment_intent_id, price_id,
             customer_email, normalized_email, license_days, amount_total, currency,
             license_id, fulfillment_action, processing_status, error_message,
             license_key_ciphertext, license_key_iv, license_key_expires_at,
             created_at, completed_at
      FROM stripe_orders WHERE stripe_event_id = ? LIMIT 1
    `).bind(stripeEventId).first();
  }

  async acquireForProcessing(input, timeoutSeconds = DEFAULT_PROCESSING_TIMEOUT_SECONDS) {
    const insertResult = await this.db.prepare(`
      INSERT OR IGNORE INTO stripe_orders (
        stripe_event_id, checkout_session_id, payment_intent_id, price_id,
        customer_email, normalized_email, license_days, amount_total, currency,
        license_id, fulfillment_action, processing_status, error_message,
        license_key_ciphertext, license_key_iv, license_key_expires_at,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'processing', NULL, NULL, NULL, NULL, ?, NULL)
    `).bind(
      input.stripeEventId, input.checkoutSessionId, input.paymentIntentId, input.priceId,
      input.customerEmail, input.normalizedEmail, input.licenseDays,
      input.amountTotal, input.currency, input.createdAt
    ).run();
    if (!insertResult.success) throw new Error("Failed to register Stripe order.");
    if (Number(insertResult.meta.changes ?? 0) === 1) return { acquired: true, status: "processing", isRetry: false };

    const staleBefore = new Date(new Date(input.createdAt).getTime() - timeoutSeconds * 1000).toISOString();
    const retryResult = await this.db.prepare(`
      UPDATE stripe_orders
      SET payment_intent_id = ?, price_id = ?, customer_email = ?, normalized_email = ?,
          license_days = ?, amount_total = ?, currency = ?, processing_status = 'processing',
          error_message = NULL, completed_at = NULL, created_at = ?
      WHERE checkout_session_id = ?
        AND (processing_status = 'failed'
          OR (processing_status = 'processing' AND created_at < ?))
    `).bind(
      input.paymentIntentId, input.priceId, input.customerEmail, input.normalizedEmail,
      input.licenseDays, input.amountTotal, input.currency, input.createdAt,
      input.checkoutSessionId, staleBefore
    ).run();
    if (!retryResult.success) throw new Error("Failed to retry Stripe order.");
    if (Number(retryResult.meta.changes ?? 0) === 1) return { acquired: true, status: "processing", isRetry: true };

    const order = await this.findByCheckoutSessionId(input.checkoutSessionId);
    return { acquired: false, status: order?.processing_status ?? "unknown", isRetry: false, order };
  }

  async markCompleted(input) {
    const result = await this.db.prepare(`
      UPDATE stripe_orders
      SET license_id = ?, fulfillment_action = ?, processing_status = 'completed',
          error_message = NULL, license_key_ciphertext = ?, license_key_iv = ?,
          license_key_expires_at = ?, completed_at = ?
      WHERE checkout_session_id = ? AND processing_status = 'processing'
    `).bind(
      input.licenseId, input.fulfillmentAction, input.licenseKeyCiphertext,
      input.licenseKeyIv, input.licenseKeyExpiresAt, input.completedAt,
      input.checkoutSessionId
    ).run();
    if (!result.success) throw new Error("Failed to complete Stripe order.");
    return Number(result.meta.changes ?? 0);
  }

  async markFailed(checkoutSessionId, errorMessage, completedAt) {
    const result = await this.db.prepare(`
      UPDATE stripe_orders SET processing_status = 'failed', error_message = ?, completed_at = ?
      WHERE checkout_session_id = ? AND processing_status = 'processing'
    `).bind(errorMessage, completedAt, checkoutSessionId).run();
    if (!result.success) throw new Error("Failed to mark Stripe order as failed.");
    return Number(result.meta.changes ?? 0);
  }

  async clearLicenseKeyDisplayByLicenseId(licenseId) {
    const result = await this.db.prepare(`
      UPDATE stripe_orders
      SET
        license_key_ciphertext = NULL,
        license_key_iv = NULL,
        license_key_expires_at = NULL
      WHERE license_id = ?
    `).bind(licenseId).run();

    if (!result.success) {
      throw new Error("Failed to clear license key display data.");
    }

    return Number(result.meta.changes ?? 0);
  }

  /**
   * 表示期限を過ぎたライセンスキーの一時保存データを削除します。
   *
   * @param {string} now ISO 8601形式の現在日時
   * @returns {Promise<number>} クリアした注文件数
   */
  async clearExpiredLicenseKeyDisplay(now) {
    const result = await this.db.prepare(`
      UPDATE stripe_orders
      SET
        license_key_ciphertext = NULL,
        license_key_iv = NULL,
        license_key_expires_at = NULL
      WHERE license_key_expires_at IS NOT NULL
        AND license_key_expires_at <= ?
        AND (
          license_key_ciphertext IS NOT NULL
          OR license_key_iv IS NOT NULL
        )
    `).bind(now).run();

    if (!result.success) {
      throw new Error("Failed to clear expired license key display data.");
    }

    return Number(result.meta.changes ?? 0);
  }

}
