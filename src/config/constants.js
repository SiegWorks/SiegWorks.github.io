export const API_VERSION = "1.0.0";

export const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

export const LICENSE_KEY_PATTERN = /^VCN-[A-HJ-NP-Z]{4}-[A-HJ-NP-Z]{4}-[A-HJ-NP-Z]{4}-[A-HJ-NP-Z]{4}$/;
export const DEVICE_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
export const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 300;
export const DEFAULT_OFFLINE_TOKEN_HOURS = 24;
export const DEFAULT_MINIMUM_VERSION = "1.0.0";
export const DEFAULT_OFFLINE_TOKEN_KEY_ID = "key-2026-01";
export const LICENSE_KEY_DISPLAY_HOURS = 24;
