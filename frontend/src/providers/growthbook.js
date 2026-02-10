// frontend/src/providers/growthbook.js
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import { GrowthBook } from '@growthbook/growthbook';

// Keep a module-scoped reference so the app can trigger reloads explicitly.
let gbProviderInstance = null;

/**
 * Minimal OpenFeature provider wrapper for GrowthBook with on-demand reload.
 * - Loads features from a backend-served JSON.
 * - Supports per-call context to avoid races with onContextChange.
 * - Exposes reload() to re-fetch features.json and emit ConfigurationChanged.
 */
class GrowthBookOFProvider {
  metadata = { name: 'growthbook' };

  constructor(features, sourceUrl) {
    this._sourceUrl = sourceUrl;           // where to re-fetch from
    this._features = features;             // last-loaded features (for debugging)
    this.attributes = {};                  // last-known attributes

    this.gb = new GrowthBook({ features, attributes: {} });

    // Minimal event emitter to integrate with OpenFeature events
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

  async initialize(context) {
    this.attributes = context || {};
    this.gb.setAttributes(this.attributes);
    this._emit(ProviderEvents.Ready, {});
  }

  async onContextChange(_oldCtx, newCtx) {
    this.attributes = newCtx || {};
    this.gb.setAttributes(this.attributes);
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  async shutdown() {
    // no-op
  }

  // ---------- Reload support ----------
  async reload() {
    if (!this._sourceUrl) return;
    const res = await fetch(this._sourceUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`[GrowthBook] reload failed (${res.status}) from ${this._sourceUrl}`);
    const features = await res.json();

    // Rebuild the GrowthBook instance to ensure a clean state
    this._features = features;
    this.gb = new GrowthBook({ features, attributes: this.attributes });

    // Notify app to re-evaluate
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  // ---- Helper: evaluate with per-call context if provided ----
  _withContextAndEval(context, fn) {
    if (context && typeof context === 'object') {
      // Use provided context immediately (prevents race with onContextChange)
      this.attributes = context;
      this.gb.setAttributes(this.attributes);
    }
    return fn();
  }

  resolveBooleanEvaluation(flagKey, defaultValue, context) {
    const value = !!this._withContextAndEval(context, () =>
      this.gb.getFeatureValue(flagKey, defaultValue)
    );
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveStringEvaluation(flagKey, defaultValue, context) {
    const value = String(
      this._withContextAndEval(context, () =>
        this.gb.getFeatureValue(flagKey, defaultValue)
      )
    );
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveNumberEvaluation(flagKey, defaultValue, context) {
    const value = Number(
      this._withContextAndEval(context, () =>
        this.gb.getFeatureValue(flagKey, defaultValue)
      )
    );
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveObjectEvaluation(flagKey, defaultValue, context) {
    const value =
      this._withContextAndEval(context, () =>
        this.gb.getFeatureValue(flagKey, defaultValue)
      );
    return { value, variant: undefined, reason: 'STATIC' };
  }
}

export async function initGrowthBook() {
  // Load features from the backend (moved under backend/growthbook)
  const apiBase = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
  const url = `${apiBase}/static/growthbook/features.json`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load GrowthBook features.json from ${url}`);
  const features = await res.json();

  const provider = new GrowthBookOFProvider(features, url);
  gbProviderInstance = provider;

  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}

/**
 * External hook for the app's Refresh button.
 * Re-fetches features.json and emits ConfigurationChanged.
 */
export async function reloadGrowthBookFeatures() {
  if (gbProviderInstance?.reload) {
    await gbProviderInstance.reload();
  }
}