import { OpenFeature } from '@openfeature/web-sdk';
import { FlagdWebProvider } from '@openfeature/flagd-web-provider';

export async function initFlagd() {
  const provider = new FlagdWebProvider({
    host: 'localhost',
    port: 8013,
    tls: false,
  });

  await OpenFeature.setProviderAndWait(provider);
  return OpenFeature.getClient('frontend');
}