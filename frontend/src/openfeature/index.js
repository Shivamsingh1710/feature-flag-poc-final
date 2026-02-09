import { OpenFeature } from '@openfeature/web-sdk';
import {
  PROVIDER_STORAGE_KEY,
  DEFAULT_PROVIDER,
  PROVIDERS
} from '../providers/registry';

export async function initOpenFeature() {
  const choice = localStorage.getItem(PROVIDER_STORAGE_KEY) || DEFAULT_PROVIDER;
  const entry = PROVIDERS[choice] ?? PROVIDERS[DEFAULT_PROVIDER];

  try {
    // Initialize chosen provider
    await entry.init();
    return OpenFeature.getClient('frontend');
  } catch (err) {
    console.error(`[OpenFeature] Provider "${choice}" failed to initialize. Falling back to "${DEFAULT_PROVIDER}".`, err);

    // fallback to default provider and also reset the choice
    localStorage.setItem(PROVIDER_STORAGE_KEY, DEFAULT_PROVIDER);

    const fallback = PROVIDERS[DEFAULT_PROVIDER];
    await fallback.init();
    return OpenFeature.getClient('frontend');
  }
}