export async function dispatchStripeEvent(event, handlers, context) {
  validateStripeEvent(event);
  const availableHandlers = handlers !== null && typeof handlers === "object" ? handlers : {};
  switch (event.type) {
    case "checkout.session.completed":
      return await dispatchToHandler(event, availableHandlers.checkoutSessionCompleted, context);
    default:
      return { handled: false, ignored: true, eventType: event.type, result: null };
  }
}

async function dispatchToHandler(event, handler, context) {
  if (typeof handler !== "function") return { handled: false, ignored: true, eventType: event.type, result: null };
  const result = await handler(event.data.object, event, context);
  return { handled: true, ignored: false, eventType: event.type, result };
}

function validateStripeEvent(event) {
  if (event === null || typeof event !== "object") throw new StripeEventFormatError("Stripe event is not an object.");
  if (typeof event.id !== "string" || event.id.trim() === "") throw new StripeEventFormatError("Stripe event ID is missing.");
  if (typeof event.type !== "string" || event.type.trim() === "") throw new StripeEventFormatError("Stripe event type is missing.");
  if (event.data === null || typeof event.data !== "object" || event.data.object === null || typeof event.data.object !== "object") {
    throw new StripeEventFormatError("Stripe event data object is missing.");
  }
}

export class StripeEventFormatError extends Error {
  constructor(message) { super(message); this.name = "StripeEventFormatError"; }
}
