import crypto from "node:crypto";

const SECRET_KEY_PATTERN = /(token|key|secret|password|private|access|apiKey|verifyToken)/i;

function clean(value?: string | null) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function configuredEncryptionKey() {
  return clean(process.env.ENCRYPTION_KEY) ?? clean(process.env.INTEGRATION_ENCRYPTION_KEY);
}

function encryptionKey() {
  const value = configuredEncryptionKey();
  if (!value) {
    throw new Error("Encryption key missing. Add ENCRYPTION_KEY to .env and restart server.");
  }

  return crypto.createHash("sha256").update(value).digest();
}

function decryptError() {
  return new Error("Saved secret cannot be decrypted. Clear and re-enter the credential.");
}

export function encryptionKeyConfigured() {
  return Boolean(configuredEncryptionKey());
}

export function encryptSecret(value?: string | null) {
  const secret = clean(value);
  if (!secret) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(encryptedValue?: string | null) {
  if (!encryptedValue) return null;

  const [version, ivValue, tagValue, ciphertextValue] = encryptedValue.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw decryptError();
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw decryptError();
  }
}

export function encryptJson(value: Record<string, unknown>) {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson(encryptedValue?: string | null) {
  const decrypted = decryptSecret(encryptedValue);
  if (!decrypted) return {};

  try {
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    throw decryptError();
  }
}

export function isSecretField(fieldName: string) {
  return SECRET_KEY_PATTERN.test(fieldName);
}

export function maskSecret(value?: string | null, visibleTail = 4) {
  const secret = clean(value);
  if (!secret) return null;

  const normalized = secret.replace(/\s+/g, "");
  const tail = normalized.slice(-Math.max(1, visibleTail));
  return `${"*".repeat(12)}${tail}`;
}

export function scrubSecretsFromLogs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => scrubSecretsFromLogs(item)) as T;
  }

  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSecretField(key) ? "[redacted]" : scrubSecretsFromLogs(item);
  }

  return output as T;
}
