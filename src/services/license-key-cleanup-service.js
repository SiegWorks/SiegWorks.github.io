import {
  StripeOrderRepository
} from "../repositories/stripe-order-repository.js";

/**
 * 表示期限を過ぎたライセンスキーの一時保存データを削除します。
 *
 * @param {object} env Cloudflare Worker環境
 * @param {string} [now] ISO 8601形式の基準日時
 * @returns {Promise<{clearedCount: number, executedAt: string}>}
 */
export async function cleanupExpiredLicenseKeys(
  env,
  now = new Date().toISOString()
) {
  if (!env?.DB) {
    throw new Error(
      "D1 database binding is not configured."
    );
  }

  const executedAt = normalizeIsoDate(now);
  const repository = new StripeOrderRepository(env.DB);

  const clearedCount =
    await repository.clearExpiredLicenseKeyDisplay(
      executedAt
    );

  console.log(
    "[Maintenance] Expired license key display data cleared.",
    {
      executedAt,
      clearedCount
    }
  );

  return {
    clearedCount,
    executedAt
  };
}

function normalizeIsoDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "Cleanup execution time is invalid."
    );
  }

  return date.toISOString();
}
