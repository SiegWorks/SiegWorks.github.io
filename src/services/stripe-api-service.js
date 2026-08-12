const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

export async function retrieveCheckoutSession(
  checkoutSessionId,
  stripeSecretKey
) {
  validateStripeConfiguration(
    checkoutSessionId,
    stripeSecretKey
  );

  const endpoint =
    `${STRIPE_API_BASE_URL}/checkout/sessions/` +
    encodeURIComponent(checkoutSessionId);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      Accept: "application/json"
    }
  });

  return await parseStripeResponse(
    response,
    "STRIPE_CHECKOUT_SESSION_INVALID"
  );
}

export async function retrieveCheckoutSessionLineItems(
  checkoutSessionId,
  stripeSecretKey
) {
  validateStripeConfiguration(
    checkoutSessionId,
    stripeSecretKey
  );

  const endpoint =
    `${STRIPE_API_BASE_URL}/checkout/sessions/` +
    `${encodeURIComponent(checkoutSessionId)}/line_items` +
    "?limit=10";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      Accept: "application/json"
    }
  });

  const body = await parseStripeResponse(
    response,
    "STRIPE_LINE_ITEMS_INVALID"
  );

  if (!Array.isArray(body.data)) {
    throw new StripeApiError(
      "STRIPE_LINE_ITEMS_INVALID",
      "Stripe line items are invalid.",
      response.status
    );
  }

  return body.data;
}

async function parseStripeResponse(
  response,
  invalidResponseCode
) {
  let body;

  try {
    body = await response.json();
  } catch {
    throw new StripeApiError(
      "STRIPE_API_RESPONSE_INVALID",
      "Stripe API returned invalid JSON.",
      response.status
    );
  }

  if (!response.ok) {
    const message = body?.error?.message;

    throw new StripeApiError(
      "STRIPE_API_REQUEST_FAILED",
      typeof message === "string"
        ? message
        : "Stripe API request failed.",
      response.status
    );
  }

  if (body === null || typeof body !== "object") {
    throw new StripeApiError(
      invalidResponseCode,
      "Stripe API response is invalid.",
      response.status
    );
  }

  return body;
}

function validateStripeConfiguration(
  checkoutSessionId,
  stripeSecretKey
) {
  if (
    typeof checkoutSessionId !== "string" ||
    checkoutSessionId.trim() === ""
  ) {
    throw new StripeApiError(
      "CHECKOUT_SESSION_ID_REQUIRED",
      "Checkout Session ID is required.",
      0
    );
  }

  if (
    typeof stripeSecretKey !== "string" ||
    stripeSecretKey.trim() === ""
  ) {
    throw new StripeApiError(
      "STRIPE_SECRET_KEY_NOT_CONFIGURED",
      "Stripe Secret Key is not configured.",
      0
    );
  }
}

export class StripeApiError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "StripeApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
