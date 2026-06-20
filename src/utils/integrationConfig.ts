export function integrationEncryptionKeyConfigured() {
  return Boolean(process.env.ENCRYPTION_KEY?.trim() || process.env.INTEGRATION_ENCRYPTION_KEY?.trim());
}

export function integrationConfigDiagnostic() {
  return {
    integrationEncryptionKeyConfigured: integrationEncryptionKeyConfigured(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || "development"
  };
}

export function localIntegrationFallbackEnabled() {
  return process.env.LOCAL_INTEGRATION_FALLBACK === "true";
}
