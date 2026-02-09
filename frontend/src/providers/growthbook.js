import { OpenFeature } from '@openfeature/web-sdk';
import { GrowthBook } from '@growthbook/growthbook';

// Minimal OpenFeature provider wrapper for GrowthBook
class GrowthBookOFProvider {
  metadata = { name: 'growthbook' };

  constructor(features) {
    this.gb = new GrowthBook({ features, attributes: {} });
  }

  async initialize(context) {
    this.gb.setAttributes(context || {});
  }

  async onContextChange(_oldCtx, newCtx) {
    this.gb.setAttributes(newCtx || {});
  }

  async shutdown() {
    // no-op
  }

  resolveBooleanEvaluation(flagKey, defaultValue) {
    const value = !!this.gb.getFeatureValue(flagKey, defaultValue);
    return { value, variant: undefined, reason: 'STATIC' };
  }
  resolveStringEvaluation(flagKey, defaultValue) {
    const value = String(this.gb.getFeatureValue(flagKey, defaultValue));
    return { value, variant: undefined, reason: 'STATIC' };
  }
  resolveNumberEvaluation(flagKey, defaultValue) {
    const value = Number(this.gb.getFeatureValue(flagKey, defaultValue));
    return { value, variant: undefined, reason: 'STATIC' };
  }
  resolveObjectEvaluation(flagKey, defaultValue) {
    const value = this.gb.getFeatureValue(flagKey, defaultValue);
    return { value, variant: undefined, reason: 'STATIC' };
  }
}

export async function initGrowthBook() {
  // Load features from a static JSON for full offline demo
  const res = await fetch('/growthbook/features.json');
  if (!res.ok) throw new Error(`Failed to load GrowthBook features.json`);
  const features = await res.json();

  const provider = new GrowthBookOFProvider(features);
  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}