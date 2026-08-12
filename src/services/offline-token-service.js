import { bytesToBase64Url, textToBase64Url } from "../utils/base64url.js";
import { pemToPkcs8Bytes } from "../utils/pem.js";

export async function createOfflineToken(input) {
  const issuedAtMilliseconds = Date.parse(input.issuedAtUtc);
  const maximumValidUntil = issuedAtMilliseconds + input.offlineTokenHours * 60 * 60 * 1e3;
  let validUntilMilliseconds = maximumValidUntil;
  if (input.license.is_lifetime !== 1 && input.license.expires_at) {
    validUntilMilliseconds = Math.min(
      maximumValidUntil,
      Date.parse(input.license.expires_at)
    );
  }
  const validUntilUtc = new Date(validUntilMilliseconds).toISOString();
  const header = {
    alg: "ES256",
    typ: "VCN-OFFLINE",
    kid: input.keyId
  };
  const payload = {
    licenseId: input.license.id,
    deviceHash: input.deviceHash,
    issuedAtUtc: input.issuedAtUtc,
    validUntilUtc,
    licenseExpiresAtUtc: input.license.expires_at,
    isLifetime: input.license.is_lifetime === 1,
    edition: input.license.edition,
    channel: input.license.channel
  };
  const encodedHeader = textToBase64Url(JSON.stringify(header));
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(input.privateKeyPem),
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return {
    token: `${signingInput}.${bytesToBase64Url(
      new Uint8Array(signature)
    )}`,
    validUntilUtc
  };
}
