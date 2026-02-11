// frontend/src/providers/registry.js
import { initFlagd } from './flagd';
import { initGrowthBook } from './growthbook';
import { initFlagsmith as initFlagsmithOffline } from './flagsmith';
import { initFlagsmithOnline } from './flagsmith_online';
import { initLaunchDarklyOfflineBackend } from './launchdarkly_offline_backend';

export const PROVIDERS = {
  flagd: {
    id: 'flagd',
    label: 'flagd (Offline JSON)',
    init: initFlagd,
  },
  growthbook: {
    id: 'growthbook',
    label: 'GrowthBook (Offline JSON)',
    init: initGrowthBook,
  },

  // Flagsmith split into two actual providers
  'flagsmith-offline': {
    id: 'flagsmith-offline',
    label: 'Flagsmith (Offline JSON)',
    init: initFlagsmithOffline,
  },
  'flagsmith-online': {
    id: 'flagsmith-online',
    label: 'Flagsmith (Online API)',
    init: initFlagsmithOnline,
  },

  launchdarkly: {
    id: 'launchdarkly',
    label: 'LaunchDarkly (Offline JSON via backend)',
    init: initLaunchDarklyOfflineBackend,
  },
};

export const DEFAULT_PROVIDER = 'flagd';
export const PROVIDER_STORAGE_KEY = 'providerChoice';

/**
 * Normalize legacy values stored earlier.
 * - "flagsmith" -> "flagsmith-offline"
 */
export function normalizeProviderChoice(choice) {
  if (choice === 'flagsmith') return 'flagsmith-offline';
  return choice;
}