const LICENSE_DAYS = 30;

const PRODUCT_DEFINITIONS = [
  {
    priceEnvName: "STRIPE_PRICE_VOICON_30",
    productEnvName: "STRIPE_PRODUCT_VOICON",
    edition: "ed_voicon"
  },
  {
    priceEnvName: "STRIPE_PRICE_DCS_LOCALIZER_30",
    productEnvName: "STRIPE_PRODUCT_DCS_LOCALIZER",
    edition: "ed_dcs_localizer"
  }
];

export function resolveStripeLicensePlan(lineItems, env) {
  const configuredProducts = validateConfiguration(env);
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new StripePriceError("STRIPE_LINE_ITEMS_EMPTY", "Stripe Line Itemsがありません。");
  }

  const supportedItems = [];
  for (const lineItem of lineItems) {
    const priceId = getPriceId(lineItem);
    if (priceId === null) continue;

    const definition = configuredProducts.find((item) => item.priceId === priceId);
    if (!definition) continue;

    const productId = getProductId(lineItem);
    if (productId !== null && productId !== definition.productId) {
      throw new StripePriceError(
        "STRIPE_PRODUCT_MISMATCH",
        "Stripe商品のProduct IDとPrice IDの組み合わせが一致しません。"
      );
    }

    supportedItems.push({
      priceId,
      productId: productId ?? definition.productId,
      edition: definition.edition,
      licenseDays: LICENSE_DAYS,
      quantity: getQuantity(lineItem)
    });
  }

  if (supportedItems.length === 0) {
    throw new StripePriceError("STRIPE_PRICE_NOT_SUPPORTED", "対応するライセンス商品がありません。");
  }
  if (supportedItems.length !== 1) {
    throw new StripePriceError("STRIPE_MULTIPLE_LICENSE_ITEMS", "複数のライセンス商品が含まれています。");
  }
  if (supportedItems[0].quantity !== 1) {
    throw new StripePriceError("STRIPE_LICENSE_QUANTITY_INVALID", "ライセンス商品の数量は1である必要があります。");
  }
  return supportedItems[0];
}

function getPriceId(lineItem) {
  if (lineItem?.price && typeof lineItem.price.id === "string" && lineItem.price.id.trim() !== "") {
    return lineItem.price.id.trim();
  }
  return null;
}

function getProductId(lineItem) {
  const product = lineItem?.price?.product;
  if (typeof product === "string" && product.trim() !== "") return product.trim();
  if (product && typeof product === "object" && typeof product.id === "string" && product.id.trim() !== "") {
    return product.id.trim();
  }
  return null;
}

function getQuantity(lineItem) {
  const quantity = Number(lineItem?.quantity);
  return Number.isInteger(quantity) && quantity >= 1 ? quantity : 0;
}

function validateConfiguration(env) {
  if (!env || typeof env !== "object") {
    throw new StripePriceError("STRIPE_ENV_INVALID", "Stripe環境設定が不正です。");
  }

  const configuredProducts = PRODUCT_DEFINITIONS.map((definition) => {
    const priceId = readRequiredEnvironmentValue(env, definition.priceEnvName);
    const productId = readRequiredEnvironmentValue(env, definition.productEnvName);
    return { ...definition, priceId, productId };
  });

  const priceIds = new Set(configuredProducts.map((item) => item.priceId));
  if (priceIds.size !== configuredProducts.length) {
    throw new StripePriceError("STRIPE_PRICE_CONFIGURATION_DUPLICATED", "ライセンス商品のPrice IDが重複しています。");
  }

  const productIds = new Set(configuredProducts.map((item) => item.productId));
  if (productIds.size !== configuredProducts.length) {
    throw new StripePriceError("STRIPE_PRODUCT_CONFIGURATION_DUPLICATED", "ライセンス商品のProduct IDが重複しています。");
  }

  return configuredProducts;
}

function readRequiredEnvironmentValue(env, name) {
  if (typeof env[name] !== "string" || env[name].trim() === "") {
    throw new StripePriceError(`${name}_NOT_CONFIGURED`, `${name}が設定されていません。`);
  }
  return env[name].trim();
}

export class StripePriceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripePriceError";
    this.code = code;
  }
}
