// frontend/src/providers/registry.js
import { initFlagd } from './flagd';
import { initGrowthBook } from './growthbook';
import { initFlagsmith } from './flagsmith';
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
  flagsmith: {
    id: 'flagsmith',
    label: 'Flagsmith (Offline JSON)',
    init: initFlagsmith,
  },
  launchdarkly: {
    id: 'launchdarkly',
    label: 'LaunchDarkly (Offline JSON)',
    init: initLaunchDarklyOfflineBackend,
  },
};

export const DEFAULT_PROVIDER = 'flagd';
export const PROVIDER_STORAGE_KEY = 'providerChoice';