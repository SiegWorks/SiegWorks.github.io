const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LICENSE_DISPLAY_CONTEXT = "voicon-license-display-v1";

export async function createHmacSha256Hex(value, secret) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export async function encryptLicenseKeyForDisplay(licenseKey, secret) {
  validateEncryptionInput(licenseKey, secret);
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(LICENSE_DISPLAY_CONTEXT) },
    key,
    encoder.encode(licenseKey)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv)
  };
}

export async function decryptLicenseKeyForDisplay(ciphertext, iv, secret) {
  if (typeof ciphertext !== "string" || ciphertext === "" || typeof iv !== "string" || iv === "") {
    throw new Error("Encrypted license key is invalid.");
  }
  const key = await deriveAesKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(iv),
      additionalData: encoder.encode(LICENSE_DISPLAY_CONTEXT)
    },
    key,
    base64ToBytes(ciphertext)
  );
  return decoder.decode(decrypted);
}

async function deriveAesKey(secret) {
  if (typeof secret !== "string" || secret.trim() === "") throw new Error("Encryption secret is not configured.");
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`${LICENSE_DISPLAY_CONTEXT}:${secret.trim()}`));
  return await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function validateEncryptionInput(licenseKey, secret) {
  if (typeof licenseKey !== "string" || licenseKey.trim() === "") throw new Error("License key is required.");
  if (typeof secret !== "string" || secret.trim() === "") throw new Error("Encryption secret is not configured.");
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
