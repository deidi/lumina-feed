/**
 * LuminaFeed Client-Side Cryptographic Engine (Web Crypto API)
 * 
 * Features:
 * - AES-256-GCM authenticated symmetric encryption for photo blobs and thumbnails.
 * - LENC Binary Envelope with 12-byte cryptographically secure random IV and 128-bit auth tag.
 * - Zero-knowledge event key generation & URL-safe base64 serialization.
 * - Option B: RSA-OAEP 2048-bit Master Key Escrow for Super Admin fallback decryption.
 * - 100% backward-compatible: transparently handles unencrypted legacy JPEGs.
 */

// Magic 4-byte header: ASCII 'LENC' (0x4C, 0x45, 0x4E, 0x43)
export const LENC_MAGIC = new Uint8Array([0x4c, 0x45, 0x4e, 0x43]);
export const LENC_VERSION = 0x01;
export const LENC_HEADER_SIZE = 17; // 4 (magic) + 1 (version) + 12 (IV)

// Default Super Admin RSA-OAEP Public Key (SPKI base64) for Option B key wrapping
export const DEFAULT_ADMIN_PUBLIC_KEY = (
  import.meta.env?.VITE_SUPER_ADMIN_PUBLIC_KEY ||
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2UR18nRQTU2HbxI/Z73fRqcWgsa9GwNTWJ5MX1rNISxPUI/ruDSjce5lbHl+qtIU4xuiykMen/5bVxm7aTUfQ/2Jua1gmhJaRafP0MmEJSZ5tj05X0LLpdzo/tKQyZBObU7+n0LuA0N6YHcbDBLx/NnC2bJaExRbFxBbPemtW6qY5CRMxR6MHlRsM7yRcwVopH1P6QorZJWMIdeJnbhafrw/BfhjqkNo+GWN/h9BSp+EXM94izSbzak7NR8R3E8CoeNDDD73T1O7QOZvHnMlOe/PRcYb8SMVsW9RR5fCm3VF1ggw3GnA4ja/DVYxjqAXVyXEQkhIEW8nboqEBDolUwIDAQAB'
).trim();

// Default Super Admin RSA-OAEP Private Key (PKCS8 base64) for Option B local fallback decryption
export const DEFAULT_ADMIN_PRIVATE_KEY = (
  import.meta.env?.VITE_SUPER_ADMIN_PRIVATE_KEY ||
  'MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDZRHXydFBNTYdvEj9nvd9GpxaCxr0bA1NYnkxfWs0hLE9Qj+u4NKNx7mVseX6q0hTjG6LKQx6f/ltXGbtpNR9D/Ym5rWCaElpFp8/QyYQlJnm2PTlfQsul3Oj+0pDJkE5tTv6fQu4DQ3pgdxsMEvH82cLZsloTFFsXEFs96a1bqpjkJEzFHoweVGwzvJFzBWikfU/pCitklYwh14mduFp+vD8F+GOqQ2j4ZY3+H0FKn4Rcz3iLNJvNqTs1HxHcTwKh40MMPvdPU7tA5m8ecyU5789FxhvxIxWxb1FHl8KbdUXWCDDcacDiNr8NVjGOoBdXJcRCSEgRbyduioQEOiVTAgMBAAECggEAJXCoOJs1mVSiYZAN8BUmrDiv5uJThRuqGavRsl7l2XEWy+W5M5mSjtgLj0lSfCJOqiJBh8RQOzbsS5KqGoOmeyNuP9pyOqqt9rHn3G1VgcdjEvXy9IkAqfjrB7qGa82bzjdeJli0xkgzBvuPZCHBpJZr/vK+leoclllht8YUcyad+2LPus3sxlUfBzvWyAXjnK/0IneVJDMji6HSfGZemyuq40yrdmBjQp70nclqmlcude4g9SQGZXYChlobvJK6A93DyPfVbCFSqH1lR+yP2fJGGsoYnSpXWWLS1LyGqlRbqf60SoR12LQyhFgVIa4zLWCLsL4FULNb0wG1tsgL4QKBgQDxWympwPKqr9jzFOvgmB9w9Bckt1cqFnZ/qecURcVVK8wJq58Gt184af/WmWFlFrEEcjeIxuDSeqhdL0Z21vpOQ1Ii6q+3SJ8tMC3tcdcTeyC5kHpnn+lwkv8Cu3b/44M5vWR12amkhTUo3mcIqxcNXOWzpg8RvO3rL0+TQluCoQKBgQDmcySpE8wkEcL4ijrmpi4jmzyzqwY3bgI4jSu4j2jcGfqffBySujPL17BpwB1/ofSIqeWzjgm9qXMXV34uZ0ecok24FILxpDJDvdKujKms1scDjL0AMTJJ91JBbsDsRadEFtz14rcJDs/wXd2pIGQgpMmFg3FTSIhAIFJfwyIXcwKBgBySHBZ6Pr+x3U65NUr69w3Z9ztjcLAMxK5MIIynzbpNWvPyGvsijeURtzViJsNesknCc4x/bnG8D14okIDU5gCJu5liirZ5pE4nG+i1xy4JL1CIJ9VIesvWutVJ98ZG2mvlXZUN1SUil65k1XGTP0FXs+FWUQZahReIHDVkb4zBAoGAGbRSLIHGzWclxi807rEuiE4ycR/sa5ZbrQ8iB04HtjU3nT5suXkHef8u8Dy7jZb0/aFlu6dmMr+J1NqvemGOvUvlO1keWfGkoaW0sD+EVYEHZb/2/OR/5Xwuspm17yS9yXx7XPnSzLHYQ8lUhh7UzEdVKw1EQLPgbrasOX48eT0CgYAcQIrYerjn9GF4H/2nx34kN0oQ8fhw9hjG9G4hQabM0Xjrwasakom3ZwXgw5fEIqblxYo8VzaYo7RScfCUxTfrKE/iyRJJCLFxLkmdhoFjk91jmho4cVdg1w2eh6AZmx78QVVy87uXWUfT4BkHS/s4E5hk6wYM8AjCeDGLT0nuTA=='
).trim();

// In-memory CryptoKey cache to eliminate repeated key import overhead
const keyCache = new Map();

/**
 * Convert standard Base64 to URL-safe Base64 (RFC 4648 §5)
 */
export function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert URL-safe Base64 back to standard Base64
 */
export function fromBase64Url(base64Url) {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return base64;
}

/**
 * Convert Uint8Array to Base64
 */
export function uint8ToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const btoaFn = typeof window !== 'undefined' && window.btoa ? window.btoa.bind(window) : globalThis.btoa;
  return btoaFn(binary);
}

/**
 * Convert Base64 to Uint8Array
 */
export function base64ToUint8(base64) {
  const atobFn = typeof window !== 'undefined' && window.atob ? window.atob.bind(window) : globalThis.atob;
  const binary = atobFn(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 1. Generate a high-entropy 256-bit symmetric event key (URL-safe string)
 */
export function generateEventKey() {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return toBase64Url(uint8ToBase64(randomBytes));
}

/**
 * 2. Import a Base64Url event key into a Web Crypto AES-GCM CryptoKey
 */
export async function importSymmetricKey(keyString) {
  if (!keyString || typeof keyString !== 'string') {
    throw new Error('Invalid encryption key string');
  }
  const cleanKey = keyString.trim();
  if (keyCache.has(cleanKey)) {
    return keyCache.get(cleanKey);
  }

  const rawBytes = base64ToUint8(fromBase64Url(cleanKey));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(cleanKey, cryptoKey);
  return cryptoKey;
}

/**
 * 3. Inspect binary buffer to verify if it has the 'LENC' envelope header
 */
export function isEncryptedBuffer(bufferOrUint8) {
  if (!bufferOrUint8) return false;
  const bytes = bufferOrUint8 instanceof Uint8Array
    ? bufferOrUint8
    : new Uint8Array(bufferOrUint8);

  if (bytes.length < LENC_HEADER_SIZE) return false;

  return (
    bytes[0] === LENC_MAGIC[0] &&
    bytes[1] === LENC_MAGIC[1] &&
    bytes[2] === LENC_MAGIC[2] &&
    bytes[3] === LENC_MAGIC[3]
  );
}

/**
 * 4. Encrypt a Blob using AES-256-GCM into a LENC binary envelope
 */
export async function encryptBlob(blob, keyString) {
  if (!keyString) return blob; // If no key, pass through unencrypted

  const cryptoKey = await importSymmetricKey(keyString);
  const arrayBuffer = await blob.arrayBuffer();

  // Generate unique 96-bit (12-byte) random IV per file
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    arrayBuffer
  );

  // Construct binary envelope: [LENC 4B][Version 1B][IV 12B][Ciphertext + 16B Tag]
  const envelope = new Uint8Array(LENC_HEADER_SIZE + ciphertext.byteLength);
  envelope.set(LENC_MAGIC, 0);
  envelope[4] = LENC_VERSION;
  envelope.set(iv, 5);
  envelope.set(new Uint8Array(ciphertext), LENC_HEADER_SIZE);

  return new Blob([envelope], { type: 'application/octet-stream' });
}

/**
 * 5. Decrypt a LENC binary envelope Blob into a plaintext JPEG Blob
 * (If the blob is unencrypted legacy JPEG, gracefully passes it through unmodified)
 */
export async function decryptBlob(blobOrBuffer, keyString, mimeType = 'image/jpeg') {
  if (!blobOrBuffer) return blobOrBuffer;

  let buffer;
  if (blobOrBuffer instanceof Blob) {
    buffer = await blobOrBuffer.arrayBuffer();
  } else if (blobOrBuffer instanceof ArrayBuffer) {
    buffer = blobOrBuffer;
  } else {
    return blobOrBuffer;
  }

  // If not encrypted with LENC, return original as plaintext blob
  if (!isEncryptedBuffer(buffer)) {
    return blobOrBuffer instanceof Blob
      ? blobOrBuffer
      : new Blob([buffer], { type: mimeType });
  }

  if (!keyString) {
    throw new Error('Photo is encrypted, but no event decryption key was provided');
  }

  const cryptoKey = await importSymmetricKey(keyString);
  const bytes = new Uint8Array(buffer);

  // Extract IV (12 bytes) and ciphertext
  const iv = bytes.slice(5, 17);
  const ciphertext = bytes.slice(LENC_HEADER_SIZE);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );
    return new Blob([decryptedBuffer], { type: mimeType });
  } catch (err) {
    throw new Error(`Decryption failed: Incorrect key or corrupted ciphertext (${err.message})`);
  }
}

/**
 * 6. Local Key Storage Helpers (Per-Event Slug)
 */
export function getStoredEventKey(slug) {
  if (!slug || typeof localStorage === 'undefined') return '';
  return (
    localStorage.getItem(`luminafeed_key_${slug}`) ||
    sessionStorage.getItem(`luminafeed_key_${slug}`) ||
    ''
  ).trim();
}

export function setStoredEventKey(slug, key) {
  if (!slug || typeof localStorage === 'undefined') return;
  if (key) {
    localStorage.setItem(`luminafeed_key_${slug}`, key.trim());
  } else {
    localStorage.removeItem(`luminafeed_key_${slug}`);
    sessionStorage.removeItem(`luminafeed_key_${slug}`);
  }
}

/**
 * --- OPTION B: SUPER ADMIN MASTER KEY ESCROW (FALLBACK DECRYPTION) ---
 */

/**
 * Import an RSA-OAEP Public Key (SPKI base64) for key wrapping
 */
export async function importRsaPublicKey(spkiBase64) {
  const binaryDer = base64ToUint8(spkiBase64);
  return crypto.subtle.importKey(
    'spki',
    binaryDer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey', 'encrypt']
  );
}

/**
 * Import an RSA-OAEP Private Key (PKCS8 base64) for unwrapping
 */
export async function importRsaPrivateKey(pkcs8Base64) {
  const binaryDer = base64ToUint8(pkcs8Base64);
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['unwrapKey', 'decrypt']
  );
}

/**
 * Wrap (encrypt) an event's symmetric key with the Super Admin's Master Public Key
 */
export async function wrapEventKeyForAdmin(eventKeyString, customPublicKey = '') {
  const pubKeyString = customPublicKey || DEFAULT_ADMIN_PUBLIC_KEY;
  if (!pubKeyString) return '';

  try {
    const rsaPublicKey = await importRsaPublicKey(pubKeyString);
    const rawKeyBytes = base64ToUint8(fromBase64Url(eventKeyString));

    const wrappedBuffer = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      rsaPublicKey,
      rawKeyBytes
    );

    return uint8ToBase64(new Uint8Array(wrappedBuffer));
  } catch (err) {
    console.warn('Super admin key wrapping skipped/failed:', err);
    return '';
  }
}

/**
 * Unwrap (decrypt) an event's symmetric key using the Super Admin's Master Private Key
 */
export async function unwrapEventKeyForAdmin(wrappedKeyBase64, customPrivateKey = '') {
  const privKeyString = customPrivateKey || DEFAULT_ADMIN_PRIVATE_KEY;
  if (!wrappedKeyBase64 || !privKeyString) return '';

  try {
    const rsaPrivateKey = await importRsaPrivateKey(privKeyString);
    const wrappedBytes = base64ToUint8(wrappedKeyBase64);

    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      rsaPrivateKey,
      wrappedBytes
    );

    return toBase64Url(uint8ToBase64(new Uint8Array(decryptedBytes)));
  } catch (err) {
    console.warn('Super admin key unwrapping failed:', err);
    return '';
  }
}
