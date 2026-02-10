import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';

class BackendLDOfflineProvider {
  metadata = { name: 'launchdarkly-offline-backend' };

  constructor(options) {
    this.apiBase = options.apiBase;
    this.cache = {}; // cache flag values keyed by flagKey

    // small event emitter so App.js refresh triggers work
    this._handlers = new Map();
    this.events = {
      addHandler: (eventType, handler) => {
        const arr = this._handlers.get(eventType) ?? [];
        arr.push(handler);
        this._handlers.set(eventType, arr);
        return { remove: () => this.events.removeHandler(eventType, handler) };
      },
      removeHandler: (eventType, handler) => {
        const arr = this._handlers.get(eventType) ?? [];
        this._handlers.set(eventType, arr.filter((h) => h !== handler));
      },
    };
  }

  _emit(eventType, payload) {
    const arr = this._handlers.get(eventType) ?? [];
    for (const h of arr) {
      try { h(payload); } catch { /* ignore */ }
    }
  }

  async _fetchFlags(context) {
    const userId = context?.userId || 'anonymous';
    const url = `${this.apiBase}/api/flags?userId=${encodeURIComponent(userId)}&provider=launchdarkly`;

    try {
      const r = await fetch(url);
      if (!r.ok) {
        // backend reachable but returned error
        console.warn(`[LD Offline Provider] Backend returned HTTP ${r.status} for ${url}`);
        return; // keep old cache
      }

      const data = await r.json();

      // Map backend response -> flag keys
      this.cache = {
        'new-badge': data.newBadge,
        'cta-color': data.ctaColor,
        'api-new-endpoint-enabled': data.apiNewEndpointEnabled,
      };

      this._emit(ProviderEvents.ConfigurationChanged, {});
    } catch (e) {
      console.warn(`[LD Offline Provider] Failed to fetch flags from ${url}`, e);
      // Do NOT throw; keep app usable (defaults will show)
    }
  }

  async initialize(context) {
    await this._fetchFlags(context);
    this._emit(ProviderEvents.Ready, {});
  }

  async onContextChange(_oldCtx, newCtx) {
    await this._fetchFlags(newCtx);
  }

  async shutdown() {}

  resolveBooleanEvaluation(flagKey, defaultValue) {
    const v = this.cache[flagKey];
    const value = (v === undefined || v === null) ? !!defaultValue : !!v;
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveStringEvaluation(flagKey, defaultValue) {
    const v = this.cache[flagKey];
    const value = (v === undefined || v === null) ? String(defaultValue) : String(v);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveNumberEvaluation(flagKey, defaultValue) {
    const v = this.cache[flagKey];
    const value = (v === undefined || v === null) ? Number(defaultValue) : Number(v);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveObjectEvaluation(flagKey, defaultValue) {
    const v = this.cache[flagKey];
    const value = (v === undefined || v === null) ? defaultValue : v;
    return { value, variant: undefined, reason: 'STATIC' };
  }
}

export async function initLaunchDarklyOfflineBackend() {
  const apiBase = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
  const provider = new BackendLDOfflineProvider({ apiBase });

  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}