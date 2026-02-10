// frontend/src/openfeature/index.js
import { OpenFeature } from '@openfeature/web-sdk';
import {
  PROVIDER_STORAGE_KEY,
  DEFAULT_PROVIDER,
  PROVIDERS
} from '../providers/registry';

// Memoized state
let initPromise = null;
let cachedClient = null;

async function setProviderByChoice(choice) {
  const entry = PROVIDERS[choice] ?? PROVIDERS[DEFAULT_PROVIDER];
  // Each provider's init() must call OpenFeature.setProviderAndWait(...)
  await entry.init();
  return OpenFeature.getClient('frontend');
}

/**
 * Initialize the provider from the user's choice (in localStorage).
 * - Does NOT mutate localStorage on failure.
 * - Memoizes the promise so duplicate callers share the same work.
 */
export async function initOpenFeature() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const choice = localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
    cachedClient = await setProviderByChoice(choice);
    return cachedClient;
  })();

  return initPromise;
}

/**
 * Re-initialize the currently chosen provider, always trying fresh.
 * - Does NOT mutate localStorage on failure.
 * - Updates the memoized promise and cached client on success.
 */
export async function reinitOpenFeature() {
  const choice = localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
  try {
    const client = await setProviderByChoice(choice);
    cachedClient = client;
    initPromise = Promise.resolve(client);
    return client;
  } catch (err) {
    // Keep user's choice; surface the error so callers can decide next steps.
    console.error(`[OpenFeature] Reinit for provider "${choice}" failed:`, err);
    throw err;
  }
}

/**
 * Ensure an OpenFeature client exists.
 * - If not ready, awaits initialization.
 * - Does NOT mutate localStorage on failure.
 */
export async function ensureOpenFeatureClient() {
  if (cachedClient) return cachedClient;
  return await initOpenFeature();
}

/** Non-throwing sync getter (may be null if called too early). */
export function getOpenFeatureClientSync() {
  return cachedClient;
}
