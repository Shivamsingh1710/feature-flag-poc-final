// src/providers/flagsmith.js
// Offline Flagsmith provider for OpenFeature (no network calls to Flagsmith API)
// Reads a static environment JSON (e.g., /flagsmith/environment.json)
// and evaluates features locally with simple segment support.
//
// Expected JSON shape (as in your public/flagsmith/environment.json):
// {
//   "version": 1,
//   "project": { "id": 1000, "name": "Local Demo Project" },
//   "features": [
//     { "id": 1, "name": "new-badge", "type": "FLAG" },
//     { "id": 2, "name": "cta-color", "type": "CONFIG" },
//     { "id": 3, "name": "api-new-endpoint-enabled", "type": "FLAG" }
//   ],
//   "segments": [
//     {
//       "id": 10,
//       "name": "userId_is_pradyun",
//       "rules": [{
//         "type": "ALL",
//         "conditions": [{ "operator": "EQUAL", "property": "userId", "value": "pradyun" }]
//       }]
//     }
//   ],
//   "feature_states": [
//     { "feature_id": 1, "enabled": false, "value": false, "segment_id": null },
//     { "feature_id": 1, "enabled": true,  "value": true,  "segment_id": 10   },
//     { "feature_id": 2, "enabled": true,  "value": "blue","segment_id": null },
//     { "feature_id": 2, "enabled": true,  "value": "green","segment_id": 10  },
//     { "feature_id": 3, "enabled": false, "value": false, "segment_id": null },
//     { "feature_id": 3, "enabled": true,  "value": true,  "segment_id": 10   }
//   ]
// }
 
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
 
class FlagsmithOfflineProvider {
  metadata = { name: 'flagsmith-offline' };
 
  constructor(options) {
    this.path = options?.path || '/flagsmith/environment.json';
    this.envDoc = null; // full JSON document
    this.featureIdByName = new Map(); // name -> id
    this.segmentById = new Map();     // id -> segment
    this.statesByFeatureId = new Map(); // feature_id -> [states...]
    this.currentContext = { userId: 'anonymous' };
 
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
 
  async _loadEnvironment() {
    const res = await fetch(this.path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Flagsmith offline: failed to load ${this.path} (HTTP ${res.status})`);
    }
    this.envDoc = await res.json();
 
    // Build indexes for quick lookup
    this.featureIdByName.clear();
    for (const f of this.envDoc.features || []) {
      this.featureIdByName.set(f.name, f.id);
    }
 
    this.segmentById.clear();
    for (const s of this.envDoc.segments || []) {
      this.segmentById.set(s.id, s);
    }
 
    this.statesByFeatureId.clear();
    for (const st of this.envDoc.feature_states || []) {
      const arr = this.statesByFeatureId.get(st.feature_id) || [];
      arr.push(st);
      this.statesByFeatureId.set(st.feature_id, arr);
    }
  }
 
  // Very small evaluator that supports the JSON you provided:
  // - Segment rules: type "ALL" with conditions of operator "EQUAL" on a property (e.g., userId)
  // - Feature state resolution: first matching segment state wins; else fall back to segment_id == null
  _matchSegment(segment, attrs) {
    // Only support "ALL" rules w/ simple EQUAL conditions (as in your environment.json)
    for (const rule of segment.rules || []) {
      if (rule.type !== 'ALL') continue;
      for (const cond of rule.conditions || []) {
        const { operator, property, value } = cond || {};
        if (operator === 'EQUAL') {
          if (String(attrs?.[property]) !== String(value)) {
            return false;
          }
        } else {
          // Unsupported operator → treat as non-match
          return false;
        }
      }
    }
    return true;
  }
 
  _resolveState(flagKey, attrs) {
    const fid = this.featureIdByName.get(flagKey);
    if (!fid) return null;
 
    const states = this.statesByFeatureId.get(fid) || [];
    if (!states.length) return null;
 
    // Compute matched segment IDs
    const matchedSegmentIds = [];
    for (const [segId, seg] of this.segmentById.entries()) {
      if (this._matchSegment(seg, attrs)) {
        matchedSegmentIds.push(segId);
      }
    }
 
    // 1) Try segment-specific state in the order they appear in file
    for (const st of states) {
      if (st.segment_id != null && matchedSegmentIds.includes(st.segment_id)) {
        return st;
      }
    }
 
    // 2) Fall back to non-segment state (segment_id == null)
    for (const st of states) {
      if (st.segment_id == null) return st;
    }
 
    return null;
  }
 
  _booleanFromState(state, defaultValue) {
    if (!state) return !!defaultValue;
    // Prefer explicit 'value' when present, else fall back to 'enabled'
    if (state.value === undefined || state.value === null) {
      return !!state.enabled;
    }
    return !!state.value;
  }
 
  _stringFromState(state, defaultValue) {
    if (!state) return String(defaultValue);
    if (state.value === undefined || state.value === null) {
      // No explicit value → fall back to default
      return String(defaultValue);
    }
    return String(state.value);
  }
 
  // ----- OpenFeature provider lifecycle -----
 
  async initialize(context) {
    this.currentContext = context || { userId: 'anonymous' };
    await this._loadEnvironment();
    this._emit(ProviderEvents.Ready, {});
  }
 
  async onContextChange(_oldCtx, newCtx) {
    this.currentContext = newCtx || { userId: 'anonymous' };
    // In offline mode, rules are deterministic; just signal change so UI refreshes.
    this._emit(ProviderEvents.ConfigurationChanged, {});
  }
 
  async shutdown() {
    // no-op
  }
 
  // ----- OpenFeature resolver mappings -----
 
  resolveBooleanEvaluation(flagKey, defaultValue /*, context? */) {
    const state = this._resolveState(flagKey, this.currentContext);
    const value = this._booleanFromState(state, defaultValue);
    return { value, variant: undefined, reason: 'STATIC' };
  }
 
  resolveStringEvaluation(flagKey, defaultValue /*, context? */) {
    const state = this._resolveState(flagKey, this.currentContext);
    const value = this._stringFromState(state, defaultValue);
    return { value, variant: undefined, reason: 'STATIC' };
  }
 
  resolveNumberEvaluation(flagKey, defaultValue /*, context? */) {
    const state = this._resolveState(flagKey, this.currentContext);
    // Numbers aren’t in your demo JSON, but we’ll coerce if provided.
    let value;
    if (!state || state.value === undefined || state.value === null || Number.isNaN(Number(state.value))) {
      value = Number(defaultValue);
    } else {
      value = Number(state.value);
    }
    return { value, variant: undefined, reason: 'STATIC' };
  }
 
  resolveObjectEvaluation(flagKey, defaultValue /*, context? */) {
    const state = this._resolveState(flagKey, this.currentContext);
    const value = (state && state.value !== undefined) ? state.value : defaultValue;
    return { value, variant: undefined, reason: 'STATIC' };
  }
}
 
// -------- Public initializer used by your app (keeps the same name) --------
export async function initFlagsmith() {
  // Allow overriding the JSON path via env (optional)
  const path = process.env.REACT_APP_FLAGSMITH_OFFLINE_PATH || '/flagsmith/environment.json';
 
  const provider = new FlagsmithOfflineProvider({ path });
  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}
 