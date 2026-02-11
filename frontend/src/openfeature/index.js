// frontend/src/openfeature/index.js
import { OpenFeature } from '@openfeature/web-sdk';
import {
  PROVIDER_STORAGE_KEY,
  DEFAULT_PROVIDER,
  PROVIDERS,
  normalizeProviderChoice,
} from '../providers/registry';

// Expose OpenFeature globally for console debugging
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-underscore-dangle
  window.__openfeature = OpenFeature;
}

let initPromise = null;
let cachedClient = null;

async function setProviderByChoice(choice) {
  const entry = PROVIDERS[choice] ?? PROVIDERS[DEFAULT_PROVIDER];
  // Each provider's init() must call OpenFeature.setProviderAndWait(...)
  await entry.init();
  return OpenFeature.getClient('frontend');
}

export async function initOpenFeature() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const raw = localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
    const choice = normalizeProviderChoice(raw);
    cachedClient = await setProviderByChoice(choice);
    return cachedClient;
  })();

  return initPromise;
}

export async function reinitOpenFeature() {
  const raw = localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
  const choice = normalizeProviderChoice(raw);
  const client = await setProviderByChoice(choice);
  cachedClient = client;
  initPromise = Promise.resolve(client);
  return client;
}

export async function ensureOpenFeatureClient() {
  if (cachedClient) return cachedClient;
  return await initOpenFeature();
}

export function getOpenFeatureClientSync() {
  return cachedClient;
}