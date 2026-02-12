// frontend/src/providers/launchdarkly_online.js
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import * as LDClient from 'launchdarkly-js-client-sdk';

let ldOnlineProviderInstance = null;

class LaunchDarklyOnlineProvider {
  metadata = { name: 'launchdarkly-online' };

  constructor({ clientSideId, baseUrl, streamUrl, eventsUrl }) {
    this.clientSideId = clientSideId;
    this.baseUrl = baseUrl;
    this.streamUrl = streamUrl;
    this.eventsUrl = eventsUrl;

    this.client = null;
    this.currentUser = { key: 'anonymous', userId: 'anonymous' };

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
      try { h(payload); } catch {}
    }
  }

  _options() {
    const opts = {};
    if (this.baseUrl) opts.baseUrl = this.baseUrl;
    if (this.streamUrl) opts.streamUrl = this.streamUrl;
    if (this.eventsUrl) opts.eventsUrl = this.eventsUrl;
    return opts;
  }

  async _ensureClient(user) {
    if (this.client) return;

    const options = this._options();
    this.client = LDClient.initialize(this.clientSideId, user, options);

    await new Promise((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onFailed = (e) => { cleanup(); reject(e || new Error('LD init failed')); };
      const cleanup = () => {
        this.client?.off('ready', onReady);
        this.client?.off('failed', onFailed);
      };
      this.client.on('ready', onReady);
      this.client.on('failed', onFailed);
    });

    // Wire change listener (fires on any flag change)
    this.client.on('change', () => this._emit(ProviderEvents.ConfigurationChanged, {}));

    this._emit(ProviderEvents.Ready, {});
  }

  _userFromContext(context) {
    const uid = (context?.userId || context?.targetingKey || 'anonymous');
    return { key: String(uid), userId: String(uid) };
  }

  async initialize(context) {
    this.currentUser = this._userFromContext(context);
    await this._ensureClient(this.currentUser);
  }

  async onContextChange(_oldCtx, newCtx) {
    this.currentUser = this._userFromContext(newCtx);
    if (!this.client) {
      await this._ensureClient(this.currentUser);
      return;
    }
    try {
      await this.client.identify(this.currentUser);
    } catch (e) {
      // Some SDK versions may not return a promise
    }
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  async shutdown() {
    try {
      await this.client?.close?.();
    } catch {
      /* ignore */
    }
  }

  async refresh() {
    // JS SDK: re-identifying pulls latest flags for this user
    if (this.client) {
      try {
        await this.client.identify(this.currentUser);
      } catch {}
      this._emit(ProviderEvents.ConfigurationChanged, {});
    }
  }

  // ---------- OpenFeature resolvers ----------
  _withContextAnd(fn, context) {
    if (context && typeof context === 'object') {
      const u = this._userFromContext(context);
      this.currentUser = u;
      // Update in background; immediate eval may use cached values
      this.client?.identify?.(u).catch(() => {});
    }
    return fn();
  }

  resolveBooleanEvaluation(flagKey, defaultValue, context) {
    const value = this._withContextAnd(() => {
      try {
        const v = this.client?.variation?.(flagKey, !!defaultValue);
        return (v === undefined || v === null) ? !!defaultValue : !!v;
      } catch {
        return !!defaultValue;
      }
    }, context);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveStringEvaluation(flagKey, defaultValue, context) {
    const value = this._withContextAnd(() => {
      try {
        const v = this.client?.variation?.(flagKey, String(defaultValue));
        return (v === undefined || v === null) ? String(defaultValue) : String(v);
      } catch {
        return String(defaultValue);
      }
    }, context);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveNumberEvaluation(flagKey, defaultValue, context) {
    const value = this._withContextAnd(() => {
      try {
        const v = this.client?.variation?.(flagKey, Number(defaultValue));
        const n = Number(v);
        return (v === undefined || v === null || Number.isNaN(n)) ? Number(defaultValue) : n;
      } catch {
        return Number(defaultValue);
      }
    }, context);
    return { value, variant: undefined, reason: 'STATIC' };
  }

  resolveObjectEvaluation(flagKey, defaultValue, context) {
    const value = this._withContextAnd(() => {
      try {
        const v = this.client?.variation?.(flagKey, defaultValue);
        return (v === undefined || v === null) ? defaultValue : v;
      } catch {
        return defaultValue;
      }
    }, context);
    return { value, variant: undefined, reason: 'STATIC' };
  }
}

export async function initLaunchDarklyOnline() {
  const clientSideId = process.env.REACT_APP_LD_CLIENT_SIDE_ID;
  if (!clientSideId) {
    throw new Error('REACT_APP_LD_CLIENT_SIDE_ID is not set (required for LaunchDarkly Online).');
  }
  const baseUrl = process.env.REACT_APP_LD_BASE_URL;       // optional (relay)
  const streamUrl = process.env.REACT_APP_LD_STREAM_URL;   // optional
  const eventsUrl = process.env.REACT_APP_LD_EVENTS_URL;   // optional

  const provider = new LaunchDarklyOnlineProvider({ clientSideId, baseUrl, streamUrl, eventsUrl });
  ldOnlineProviderInstance = provider;

  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}

export async function refreshLaunchDarklyOnline() {
  if (ldOnlineProviderInstance?.refresh) {
    await ldOnlineProviderInstance.refresh();
  }
}