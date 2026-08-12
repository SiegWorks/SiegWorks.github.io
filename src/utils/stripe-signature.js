const DEFAULT_TOLERANCE_SECONDS = 300;
const textEncoder = new TextEncoder();

export async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS) {
  if (typeof rawBody !== "string") return { valid: false, reason: "RAW_BODY_MISSING" };
  if (typeof signatureHeader !== "string" || signatureHeader.trim() === "") return { valid: false, reason: "SIGNATURE_HEADER_MISSING" };
  if (typeof webhookSecret !== "string" || webhookSecret.trim() === "") return { valid: false, reason: "WEBHOOK_SECRET_MISSING" };

  const parsedHeader = parseStripeSignatureHeader(signatureHeader);
  if (parsedHeader.timestamp === null) return { valid: false, reason: "SIGNATURE_TIMESTAMP_MISSING" };
  if (parsedHeader.v1Signatures.length === 0) return { valid: false, reason: "SIGNATURE_V1_MISSING" };

  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - parsedHeader.timestamp) > toleranceSeconds) {
    return { valid: false, reason: "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE" };
  }

  const expectedSignature = await createHmacSha256Hex(`${parsedHeader.timestamp}.${rawBody}`, webhookSecret);
  const matched = parsedHeader.v1Signatures.some((received) => constantTimeHexEquals(expectedSignature, received));
  return matched ? { valid: true, reason: null } : { valid: false, reason: "SIGNATURE_MISMATCH" };
}

function parseStripeSignatureHeader(signatureHeader) {
  let timestamp = null;
  const v1Signatures = [];
  for (const part of signatureHeader.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) timestamp = parsed;
    }
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) v1Signatures.push(value.toLowerCase());
  }
  return { timestamp, v1Signatures };
}

async function createHmacSha256Hex(payload, secret) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeHexEquals(expectedHex, receivedHex) {
  if (typeof expectedHex !== "string" || typeof receivedHex !== "string") return false;
  const expected = expectedHex.toLowerCase();
  const received = receivedHex.toLowerCase();
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return difference === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
