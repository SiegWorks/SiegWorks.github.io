import { LICENSE_KEY_DISPLAY_HOURS } from "../config/constants.js";
import { StripeEventFormatError } from "./stripe-event-service.js";
import { StripeEventRepository } from "../repositories/stripe-event-repository.js";
import { StripeOrderRepository } from "../repositories/stripe-order-repository.js";
import { retrieveCheckoutSessionLineItems } from "./stripe-api-service.js";
import { resolveStripeLicensePlan } from "./stripe-price-service.js";
import { StripeLicenseService } from "./stripe-license-service.js";
import { encryptLicenseKeyForDisplay } from "../utils/crypto.js";

export async function processCheckoutSessionCompleted(checkoutSession, event, context) {
  validateInput(checkoutSession, event, context);

  const eventRepository = new StripeEventRepository(context.env.DB);
  const orderRepository = new StripeOrderRepository(context.env.DB);
  const startedAt = new Date().toISOString();

  const eventAcquisition = await eventRepository.acquireForProcessing(event.id, event.type, startedAt);
  if (!eventAcquisition.acquired) {
    return {
      checkoutSessionId: checkoutSession.id,
      status: "duplicate",
      existingStatus: eventAcquisition.status
    };
  }

  let orderAcquired = false;
  try {
    ensurePaidCheckoutSession(checkoutSession);

    const lineItems = await retrieveCheckoutSessionLineItems(
      checkoutSession.id,
      context.env.STRIPE_SECRET_KEY
    );
    const licensePlan = resolveStripeLicensePlan(lineItems, context.env);
    const customer = extractCustomer(checkoutSession);

    const orderInput = {
      stripeEventId: event.id,
      checkoutSessionId: checkoutSession.id,
      paymentIntentId: normalizeOptionalId(checkoutSession.payment_intent),
      priceId: licensePlan.priceId,
      customerEmail: customer.email,
      normalizedEmail: customer.email.toLowerCase(),
      licenseDays: licensePlan.licenseDays,
      amountTotal: normalizeNullableInteger(checkoutSession.amount_total),
      currency: normalizeOptionalString(checkoutSession.currency)?.toLowerCase() ?? null,
      createdAt: startedAt
    };

    const orderAcquisition = await orderRepository.acquireForProcessing(orderInput);
    if (!orderAcquisition.acquired) {
      await eventRepository.markCompleted(event.id, new Date().toISOString());
      return {
        checkoutSessionId: checkoutSession.id,
        status: "duplicate_order",
        existingStatus: orderAcquisition.status
      };
    }
    orderAcquired = true;

    const licenseService = new StripeLicenseService(context.env.DB, context.env.LICENSE_HMAC_KEY);
    const licenseResult = await licenseService.processPurchase({
      customerName: customer.name,
      customerEmail: customer.email,
      licenseDays: licensePlan.licenseDays,
      edition: licensePlan.edition,
      channel: "release",
      memo: `Stripe Checkout Session: ${checkoutSession.id}`,
      now: startedAt
    });

    let encryptedKey = null;
    let keyExpiresAt = null;
    if (licenseResult.licenseKey !== null) {
      encryptedKey = await encryptLicenseKeyForDisplay(
        licenseResult.licenseKey,
        context.env.LICENSE_HMAC_KEY
      );
      keyExpiresAt = addHours(startedAt, LICENSE_KEY_DISPLAY_HOURS);
    }

    const completedAt = new Date().toISOString();
    const orderChanged = await orderRepository.markCompleted({
      checkoutSessionId: checkoutSession.id,
      licenseId: licenseResult.licenseId,
      fulfillmentAction: licenseResult.action,
      licenseKeyCiphertext: encryptedKey?.ciphertext ?? null,
      licenseKeyIv: encryptedKey?.iv ?? null,
      licenseKeyExpiresAt: keyExpiresAt,
      completedAt
    });
    if (orderChanged !== 1) throw new Error("Stripe order could not be marked as completed.");

    const eventChanged = await eventRepository.markCompleted(event.id, completedAt);
    if (eventChanged !== 1) throw new Error("Stripe event could not be marked as completed.");

    return {
      checkoutSessionId: checkoutSession.id,
      status: "completed",
      action: licenseResult.action,
      licenseId: licenseResult.licenseId,
      expiresAt: licenseResult.expiresAt,
      licenseDays: licenseResult.licenseDays,
      licenseKeyAvailableUntil: keyExpiresAt
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    if (orderAcquired) {
      try { await orderRepository.markFailed(checkoutSession.id, getErrorMessage(error), failedAt); }
      catch (markOrderFailedError) { console.error("[Stripe] Failed to mark order as failed.", markOrderFailedError); }
    }
    try { await eventRepository.markFailed(event.id, getErrorMessage(error), failedAt); }
    catch (markEventFailedError) { console.error("[Stripe] Failed to mark event as failed.", markEventFailedError); }
    throw error;
  }
}

function validateInput(checkoutSession, event, context) {
  if (!checkoutSession || typeof checkoutSession !== "object" || typeof checkoutSession.id !== "string" || checkoutSession.id.trim() === "") {
    throw new StripeEventFormatError("Checkout Session ID is missing.");
  }
  if (!event || typeof event !== "object" || typeof event.id !== "string" || event.id.trim() === "") {
    throw new StripeEventFormatError("Stripe event is invalid.");
  }
  if (!context || typeof context !== "object" || typeof context.requestId !== "string" || context.requestId.trim() === "") {
    throw new Error("Stripe processing context is invalid.");
  }
  if (!context.env?.DB) throw new Error("D1 database binding is not configured.");
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_VOICON_30",
    "STRIPE_PRODUCT_VOICON",
    "STRIPE_PRICE_DCS_LOCALIZER_30",
    "STRIPE_PRODUCT_DCS_LOCALIZER",
    "LICENSE_HMAC_KEY"
  ]) {
    if (typeof context.env[name] !== "string" || context.env[name].trim() === "") throw new Error(`${name} is not configured.`);
  }
}

function ensurePaidCheckoutSession(session) {
  if (session.mode !== "payment") throw new Error("Checkout Session mode is not payment.");
  if (session.payment_status !== "paid") throw new Error("Checkout Session is not paid.");
}

function extractCustomer(session) {
  const emailCandidates = [session.customer_details?.email, session.customer_email];
  const email = emailCandidates.find((value) => typeof value === "string" && value.trim() !== "")?.trim();
  if (!email) throw new Error("Customer email is missing from Checkout Session.");
  const name = typeof session.customer_details?.name === "string" && session.customer_details.name.trim() !== ""
    ? session.customer_details.name.trim()
    : email;
  return { email, name };
}

function normalizeOptionalId(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value && typeof value === "object" && typeof value.id === "string") return value.id.trim();
  return null;
}
function normalizeOptionalString(value) { return typeof value === "string" && value.trim() !== "" ? value.trim() : null; }
function normalizeNullableInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function addHours(isoDate, hours) { const date = new Date(isoDate); date.setUTCHours(date.getUTCHours() + hours); return date.toISOString(); }
function getErrorMessage(error) { return error instanceof Error && error.message.trim() !== "" ? error.message.slice(0, 1000) : "Unknown Stripe webhook processing error."; }
