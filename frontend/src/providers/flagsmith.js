// src/providers/flagsmith.js
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import flagsmith from 'flagsmith';

/**
 * OpenFeature Provider wrapper for Flagsmith using the hosted (or self-hosted) API.
 * - Remote evaluation via Flagsmith API (Cloud default, override `api` for self-hosted).
 * - Identity-based targeting: we call `identify(identity)` and set a `userId` trait
 *   so segments/rules referencing "userId" match correctly.
 * - Optional realtime updates: set REACT_APP_FLAGSMITH_REALTIME=true
 * - Emits OpenFeature `ConfigurationChanged` when flags change.
 */
class FlagsmithOFProvider {
  metadata = { name: 'flagsmith' };

  constructor(options) {
    this.options = options || {};
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
    const identity = context?.userId || 'anonymous';

    const initOpts = {
      environmentID: this.options.environmentID, // required
      // Default API is Flagsmith Cloud edge if not provided
      ...(this.options.api ? { api: this.options.api } : {}),
      identity,
      cacheFlags: true,
      enableAnalytics: false,
      // Realtime is optional (SSE); enable via env var if desired
      ...(this.options.realtime ? { realtime: true } : {}),
      onChange: () => {
        // any server-pushed or local change
        this._emit(ProviderEvents.ConfigurationChanged, {});
      },
    };

    await flagsmith.init(initOpts);

    // Keep trait aligned so rules that reference "userId" match
    try {
      await flagsmith.setTrait('userId', identity);
    } catch {
      // ignore
    }

    // signal ready (OpenFeature also emits Ready on setProviderAndWait)
    this._emit(ProviderEvents.Ready, {});
  }

  async onContextChange(_oldCtx, newCtx) {
    const identity = newCtx?.userId || 'anonymous';
    await flagsmith.identify(identity);
    try {
      await flagsmith.setTrait('userId', identity);
    } catch {
      // ignore
    }
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  async shutdown() {
    // Flagsmith web SDK has no explicit shutdown
  }

  // ---- OpenFeature resolver mappings ----

  resolveBooleanEvaluation(flagKey, defaultValue) {
    const v = flagsmith.getValue(flagKey);
    const value =
      v === undefined || v === null
        ? !!defaultValue
        : typeof v === 'boolean'
          ? v
          : typeof v === 'string'
            ? v.toLowerCase() === 'true'
            : typeof v === 'number'
              ? v !== 0
              : !!defaultValue;

    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveStringEvaluation(flagKey, defaultValue) {
    const v = flagsmith.getValue(flagKey);
    const value = v === undefined || v === null ? String(defaultValue) : String(v);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveNumberEvaluation(flagKey, defaultValue) {
    const v = flagsmith.getValue(flagKey);
    let value;
    if (v === undefined || v === null) {
      value = Number(defaultValue);
    } else if (typeof v === 'number') {
      value = v;
    } else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      value = Number(v);
    } else {
      value = Number(defaultValue);
    }
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveObjectEvaluation(flagKey, defaultValue) {
    const v = flagsmith.getValue(flagKey);
    const value = v === undefined || v === null ? defaultValue : v;
    return { value, variant: undefined, reason: 'STATIC' };
  }
}

// -------- Public initializer used by your app --------

export async function initFlagsmith() {
  const environmentID = process.env.REACT_APP_FLAGSMITH_ENV_ID;
  if (!environmentID) {
    throw new Error(
      'Flagsmith: REACT_APP_FLAGSMITH_ENV_ID is missing. Set it in .env.local'
    );
  }

  const api = process.env.REACT_APP_FLAGSMITH_API || undefined;
  const realtimeEnv = process.env.REACT_APP_FLAGSMITH_REALTIME || '';
  const realtime = /^true$/i.test(realtimeEnv);

  const provider = new FlagsmithOFProvider({
    environmentID,
    api,       // optional (self-hosted)
    realtime,  // optional
  });

  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}