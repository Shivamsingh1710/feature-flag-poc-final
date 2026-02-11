// frontend/src/providers/flagsmith_online.js
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import flagsmith from 'flagsmith';

let fsOnlineProviderInstance = null;

class FlagsmithOnlineProvider {
  metadata = { name: 'flagsmith-online' };

  constructor(options) {
    this.environmentID = options.environmentID; // REQUIRED
    this.api = options.api;                     // optional override for self-hosted
    this.enableAnalytics = options.enableAnalytics ?? false;
    this.realtime = options.realtime ?? false;  // optional SSE

    this.identityTraitKey = options.identityTraitKey ?? 'userId';
    this.currentContext = { userId: 'anonymous' };

    this._handlers = new Map();
    this.events = {
      addHandler: (type, handler) => {
        const arr = this._handlers.get(type) ?? [];
        arr.push(handler);
        this._handlers.set(type, arr);
        return { remove: () => this.events.removeHandler(type, handler) };
      },
      removeHandler: (type, handler) => {
        const arr = this._handlers.get(type) ?? [];
        this._handlers.set(type, arr.filter((h) => h !== handler));
      },
    };

    // Expose SDK for console diagnostics
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-underscore-dangle
      window.__flagsmith = flagsmith;
    }
  }

  _emit(type, payload) {
    (this._handlers.get(type) ?? []).forEach((h) => {
      try { h(payload); } catch {}
    });
  }

  async _forceRefresh() {
    try {
      await flagsmith.getFlags?.();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Flagsmith FE] getFlags() failed (transient?)', e);
    }
  }

  async _identify(identity) {
    await flagsmith.identify(identity);
    try {
      await flagsmith.setTrait(this.identityTraitKey, identity);
    } catch {
      // ignore
    }
    // Ensure we have fresh flags for this identity
    await this._forceRefresh();
  }

  async _wireEventsOnce() {
    // Avoid wiring multiple times if provider is re-created
    if (this._wired) return;
    const onChange = () => this._emit(ProviderEvents.ConfigurationChanged, {});
    flagsmith.on?.('change', onChange);
    this._wired = true;
  }

  async initialize(context) {
    if (!this.environmentID) {
      throw new Error('[FlagsmithOnlineProvider] REACT_APP_FLAGSMITH_ENV_ID is missing');
    }
    this.currentContext = context || { userId: 'anonymous' };
    const identity = this.currentContext.userId || 'anonymous';

    // eslint-disable-next-line no-console
    console.log('[Flagsmith FE] initialize with', {
      environmentID: this.environmentID,
      api: this.api || '(cloud default)',
      identity,
      traitKey: this.identityTraitKey,
      realtime: this.realtime,
      alreadyInitialised: !!flagsmith.initialised,
    });

    if (!flagsmith.initialised) {
      // First time this tab: fully init SDK
      await new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onError = (e) => { cleanup(); reject(e); };
        const cleanup = () => {
          flagsmith.off?.('ready', onReady);
          flagsmith.off?.('error', onError);
        };
        flagsmith.on?.('ready', onReady);
        flagsmith.on?.('error', onError);

        flagsmith.init({
          environmentID: this.environmentID,
          api: this.api, // optional override
          identity,
          cacheFlags: true,
          enableAnalytics: this.enableAnalytics,
          realtime: this.realtime,
        });
      });
      await this._wireEventsOnce();
      // Ensure trait + latest flags
      await this._identify(identity);
      // eslint-disable-next-line no-console
      console.log('[Flagsmith FE] ready (first init) for identity:', identity);
      this._emit(ProviderEvents.Ready, {});
      return;
    }

    // SDK already initialised in this page:
    // just identify, set trait, refresh flags, and emit Ready so OF caller can proceed.
    await this._wireEventsOnce();
    await this._identify(identity);
    // eslint-disable-next-line no-console
    console.log('[Flagsmith FE] ready (re-init path) for identity:', identity);
    this._emit(ProviderEvents.Ready, {});
  }

  async onContextChange(_oldCtx, newCtx) {
    this.currentContext = newCtx || { userId: 'anonymous' };
    const identity = this.currentContext.userId || 'anonymous';
    // eslint-disable-next-line no-console
    console.log('[Flagsmith FE] onContextChange -> identity:', identity);
    await this._identify(identity);
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  async shutdown() {
    // SDK has no explicit shutdown
  }

  async refresh() {
    await this._forceRefresh();
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }

  // ----- OpenFeature resolvers -----
  resolveBooleanEvaluation(flagKey, defaultValue /*, contextIgnoredBySDK */) {
    try {
      const has = flagsmith.hasFeature?.(flagKey);
      const value = (has === undefined || has === null) ? !!defaultValue : !!has;
      return { value, variant: undefined, reason: 'STATIC' };
    } catch {
      return { value: !!defaultValue, variant: undefined, reason: 'ERROR' };
    }
  }

  resolveStringEvaluation(flagKey, defaultValue /*, contextIgnoredBySDK */) {
    try {
      const v = flagsmith.getValue?.(flagKey);
      const value = (v === undefined || v === null) ? String(defaultValue) : String(v);
      return { value, variant: undefined, reason: 'STATIC' };
    } catch {
      return { value: String(defaultValue), variant: undefined, reason: 'ERROR' };
    }
  }

  resolveNumberEvaluation(flagKey, defaultValue /*, contextIgnoredBySDK */) {
    try {
      const v = flagsmith.getValue?.(flagKey);
      const n = Number(v);
      const value = (v === undefined || v === null || Number.isNaN(n)) ? Number(defaultValue) : n;
      return { value, variant: undefined, reason: 'STATIC' };
    } catch {
      return { value: Number(defaultValue), variant: undefined, reason: 'ERROR' };
    }
  }

  resolveObjectEvaluation(flagKey, defaultValue /*, contextIgnoredBySDK */) {
    try {
      const v = flagsmith.getValue?.(flagKey);
      let value = v;
      if (typeof v === 'string') {
        try { value = JSON.parse(v); } catch { /* keep as string */ }
      }
      if (value === undefined || value === null) value = defaultValue;
      return { value, variant: undefined, reason: 'STATIC' };
    } catch {
      return { value: defaultValue, variant: undefined, reason: 'ERROR' };
    }
  }
}

export async function initFlagsmithOnline() {
  const envId = process.env.REACT_APP_FLAGSMITH_ENV_ID;
  if (!envId) {
    throw new Error('REACT_APP_FLAGSMITH_ENV_ID is not set (required for Flagsmith Online).');
  }
  const api = process.env.REACT_APP_FLAGSMITH_API_URL; // optional (self-hosted or explicit cloud)
  const realtime = String(process.env.REACT_APP_FLAGSMITH_REALTIME || '').toLowerCase() === 'true';

  const provider = new FlagsmithOnlineProvider({
    environmentID: envId,
    api,
    realtime,
  });

  fsOnlineProviderInstance = provider;
  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}

export async function refreshFlagsmithOnline() {
  if (fsOnlineProviderInstance?.refresh) {
    await fsOnlineProviderInstance.refresh();
  }
}