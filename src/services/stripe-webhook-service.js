import { createRequestId, jsonResponse } from "../utils/http.js";
import { verifyStripeSignature } from "../utils/stripe-signature.js";
import { dispatchStripeEvent, StripeEventFormatError } from "./stripe-event-service.js";
import { processCheckoutSessionCompleted } from "./checkout-session-completed-service.js";

export async function processStripeWebhook(request, env) {
  const requestId = createRequestId();
  try {
    const rawBody = await request.text();
    if (rawBody.length === 0) return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_BODY_MISSING", message: "Webhookの本文がありません。" }, 400);

    if (typeof env.STRIPE_WEBHOOK_SECRET !== "string" || env.STRIPE_WEBHOOK_SECRET.trim() === "") {
      return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_CONFIGURATION_ERROR", message: "Webhookの設定に問題があります。" }, 500);
    }

    const verification = await verifyStripeSignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
    if (!verification.valid) {
      console.warn("[Stripe] Webhook signature verification failed.", { requestId, reason: verification.reason });
      return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_SIGNATURE_INVALID", message: "Webhook署名を確認できませんでした。" }, 400);
    }

    let event;
    try { event = JSON.parse(rawBody); }
    catch { return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_JSON_INVALID", message: "WebhookのJSON形式が不正です。" }, 400); }

    const dispatchResult = await dispatchStripeEvent(
      event,
      { checkoutSessionCompleted: processCheckoutSessionCompleted },
      { requestId, env }
    );

    if (dispatchResult.ignored) {
      return jsonResponse({ success: true, requestId, eventId: event.id, eventType: event.type, handled: false, message: "処理対象外のStripeイベントです。" });
    }

    return jsonResponse({ success: true, requestId, eventId: event.id, eventType: event.type, handled: true, data: dispatchResult.result });
  } catch (error) {
    if (error instanceof StripeEventFormatError) {
      return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_EVENT_INVALID", message: "Webhookイベントの形式が不正です。" }, 400);
    }
    console.error("[Stripe] Webhook processing failed.", requestId, error);
    return jsonResponse({ success: false, requestId, errorCode: "STRIPE_WEBHOOK_INTERNAL_ERROR", message: "Stripe Webhookの処理中にエラーが発生しました。" }, 500);
  }
}
