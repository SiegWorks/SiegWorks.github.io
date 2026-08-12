export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}
export function pemToPkcs8Bytes(pem) {
  const normalized = pem.replace(/\r/g, "").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\n/g, "").trim();
  if (normalized.length === 0) {
    throw new Error("The private key PEM is empty.");
  }
  return base64ToBytes(normalized);
}
