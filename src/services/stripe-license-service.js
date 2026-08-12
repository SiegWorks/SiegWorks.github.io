import { LicenseRepository } from "../repositories/license-repository.js";
import { createHmacSha256Hex } from "../utils/crypto.js";
import { generateLicenseKey } from "../utils/license-key.js";

const MAX_LICENSE_KEY_GENERATION_ATTEMPTS = 5;

export class StripeLicenseService {
  constructor(db, licenseHmacKey) {
    if (!db) throw new StripeLicenseProcessingError("DATABASE_NOT_CONFIGURED", "Database is not configured.");
    if (typeof licenseHmacKey !== "string" || licenseHmacKey.trim() === "") {
      throw new StripeLicenseProcessingError("LICENSE_HMAC_KEY_NOT_CONFIGURED", "License HMAC key is not configured.");
    }
    this.licenseRepository = new LicenseRepository(db);
    this.licenseHmacKey = licenseHmacKey.trim();
  }

  async processPurchase(input) {
    const purchase = normalizePurchaseInput(input);
    const activeLicense = await this.licenseRepository.findActiveByNormalizedEmailAndEdition(purchase.normalizedEmail, purchase.edition);
    if (activeLicense !== null) return await this.extendExistingLicense(activeLicense, purchase);
    return await this.issueNewLicense(purchase);
  }

  async extendExistingLicense(activeLicense, purchase) {
    if (Number(activeLicense.is_lifetime) === 1) {
      throw new StripeLicenseProcessingError("ACTIVE_LIFETIME_LICENSE_EXISTS", "An active lifetime license already exists.");
    }
    const expiresAt = calculateExtendedExpiresAt(activeLicense.expires_at, purchase.now, purchase.licenseDays);
    const changedRows = await this.licenseRepository.extendActiveLicense(
      Number(activeLicense.id),
      {
        customerName: purchase.customerName,
        customerEmail: purchase.customerEmail,
        expiresAt,
        now: purchase.now
      }
    );
    if (changedRows !== 1) throw new StripeLicenseProcessingError("LICENSE_EXTENSION_FAILED", "The active license could not be extended.");
    return {
      action: "extended",
      licenseId: Number(activeLicense.id),
      licenseKey: null,
      customerName: purchase.customerName,
      customerEmail: purchase.customerEmail,
      normalizedEmail: purchase.normalizedEmail,
      expiresAt,
      licenseDays: purchase.licenseDays
    };
  }

  async issueNewLicense(purchase) {
    const expiresAt = addDaysToIsoDate(purchase.now, purchase.licenseDays);
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_LICENSE_KEY_GENERATION_ATTEMPTS; attempt += 1) {
      const licenseKey = generateLicenseKey();
      const licenseHash = await createHmacSha256Hex(licenseKey, this.licenseHmacKey);
      try {
        const licenseId = await this.licenseRepository.insert({
          licenseHash,
          customerName: purchase.customerName,
          customerEmail: purchase.customerEmail,
          edition: purchase.edition,
          channel: purchase.channel,
          expiresAt,
          isLifetime: false,
          memo: purchase.memo,
          now: purchase.now
        });
        return {
          action: "issued",
          licenseId,
          licenseKey,
          customerName: purchase.customerName,
          customerEmail: purchase.customerEmail,
          normalizedEmail: purchase.normalizedEmail,
          expiresAt,
          licenseDays: purchase.licenseDays
        };
      } catch (error) {
        lastError = error;
        const concurrent = await this.licenseRepository.findActiveByNormalizedEmailAndEdition(purchase.normalizedEmail, purchase.edition);
        if (concurrent !== null) return await this.extendExistingLicense(concurrent, purchase);
      }
    }
    throw new StripeLicenseProcessingError("LICENSE_ISSUE_FAILED", "A new license could not be issued.", lastError);
  }
}

function normalizePurchaseInput(input) {
  if (!input || typeof input !== "object") throw new StripeLicenseProcessingError("PURCHASE_INPUT_INVALID", "Purchase input is invalid.");
  const customerEmail = typeof input.customerEmail === "string" ? input.customerEmail.trim() : "";
  if (customerEmail === "") throw new StripeLicenseProcessingError("CUSTOMER_EMAIL_REQUIRED", "Customer email is required.");
  if (customerEmail.length > 320) throw new StripeLicenseProcessingError("CUSTOMER_EMAIL_TOO_LONG", "Customer email is too long.");
  const normalizedEmail = customerEmail.toLowerCase();
  const customerName = typeof input.customerName === "string" && input.customerName.trim() !== "" ? input.customerName.trim() : customerEmail;
  const licenseDays = Number(input.licenseDays);
  if (!Number.isInteger(licenseDays) || licenseDays !== 30) throw new StripeLicenseProcessingError("LICENSE_DAYS_INVALID", "License days must be 30.");
  const nowDate = typeof input.now === "string" ? new Date(input.now) : new Date();
  if (Number.isNaN(nowDate.getTime())) throw new StripeLicenseProcessingError("PURCHASE_TIME_INVALID", "Purchase time is invalid.");
  return {
    customerName,
    customerEmail,
    normalizedEmail,
    licenseDays,
    edition: normalizeEdition(input.edition),
    channel: typeof input.channel === "string" && input.channel.trim() !== "" ? input.channel.trim().toLowerCase() : "release",
    memo: typeof input.memo === "string" && input.memo.trim() !== "" ? input.memo.trim() : null,
    now: nowDate.toISOString()
  };
}

function normalizeEdition(value) {
  const edition = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!["ed_voicon", "ed_dcs_localizer"].includes(edition)) {
    throw new StripeLicenseProcessingError("EDITION_INVALID", "Edition must be ed_voicon or ed_dcs_localizer.");
  }
  return edition;
}

function calculateExtendedExpiresAt(currentExpiresAt, now, licenseDays) {
  const nowDate = new Date(now);
  let baseDate = nowDate;
  if (typeof currentExpiresAt === "string" && currentExpiresAt.trim() !== "") {
    const currentExpiration = new Date(currentExpiresAt);
    if (!Number.isNaN(currentExpiration.getTime()) && currentExpiration.getTime() > nowDate.getTime()) baseDate = currentExpiration;
  }
  return addDaysToIsoDate(baseDate.toISOString(), licenseDays);
}
function addDaysToIsoDate(isoDate, days) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) throw new StripeLicenseProcessingError("DATE_CALCULATION_FAILED", "The license expiration date could not be calculated.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
export class StripeLicenseProcessingError extends Error {
  constructor(code, message, cause = null) { super(message); this.name = "StripeLicenseProcessingError"; this.code = code; this.cause = cause; }
}
