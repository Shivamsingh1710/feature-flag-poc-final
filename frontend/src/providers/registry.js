// frontend/src/providers/registry.js
import { initFlagd } from './flagd';
import { initGrowthBook } from './growthbook';
import { initFlagsmith as initFlagsmithOffline } from './flagsmith';
import { initFlagsmithOnline } from './flagsmith_online';
import { initLaunchDarklyOfflineBackend } from './launchdarkly_offline_backend';
import { initLaunchDarklyOnline } from './launchdarkly_online';

export const PROVIDERS = {
  flagd: {
    id: 'flagd',
    label: 'flagd (Offline JSON)',
    init: initFlagd,
  },

  // GrowthBook (offline only)
  growthbook: {
    id: 'growthbook',
    label: 'GrowthBook (Offline JSON)',
    init: initGrowthBook,
  },

  // Flagsmith split into offline & online
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

  // LaunchDarkly split into offline (via backend) & online (JS SDK)
  launchdarkly: {
    id: 'launchdarkly',
    label: 'LaunchDarkly (Offline JSON via backend)',
    init: initLaunchDarklyOfflineBackend,
  },
  'launchdarkly-online': {
    id: 'launchdarkly-online',
    label: 'LaunchDarkly (Online SDK - browser)',
    init: initLaunchDarklyOnline,
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
