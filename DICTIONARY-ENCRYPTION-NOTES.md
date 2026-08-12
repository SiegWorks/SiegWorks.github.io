# Dictionary encryption implementation

- Required Worker Secret: `DICTIONARY_KEY_V1`
- Value format: Base64 encoded 32 random bytes (AES-256 key).
- Licensed clients receive the key with the same validity as the 24-hour offline token and cache it inside DPAPI-protected `license.dat`.
- Trial clients obtain the key online and keep it in memory only.
- Current write key version: 1.
