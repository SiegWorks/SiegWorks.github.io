import {
  processStripeWebhook
} from "../services/stripe-webhook-service.js";

import {
  processStripePurchaseResult
} from "../services/stripe-purchase-result-service.js";

export async function handleStripeRoute(
  request,
  env,
  pathname
) {
  if (
    request.method === "POST" &&
    pathname === "/api/stripe/webhook"
  ) {
    return await processStripeWebhook(request, env);
  }

  if (
    request.method === "GET" &&
    pathname === "/api/stripe/result"
  ) {
    return await processStripePurchaseResult(
      request,
      env
    );
  }

  return null;
}
