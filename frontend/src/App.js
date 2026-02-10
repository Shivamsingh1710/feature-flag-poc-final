import React, { useEffect, useState, useCallback } from 'react';
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import { initOpenFeature } from './openfeature';

export default function App() {
  const [ofClient, setOfClient] = useState(null);
  const [userId, setUserId] = useState('anonymous');
  const [flags, setFlags] = useState({ newBadge: false, ctaColor: 'blue' });
  const apiBase = 'http://localhost:8000';
  const providerChoice = localStorage.getItem('providerChoice') || 'flagd';

  const refreshFE = useCallback(async () => {
    if (!ofClient) return;
    const newBadge = await ofClient.getBooleanValue('new-badge', false);
    const ctaColor = await ofClient.getStringValue('cta-color', 'blue');
    setFlags({ newBadge, ctaColor });
  }, [ofClient]);

  const refreshBE = useCallback(async (uid) => {
    try {
      const r = await fetch(
        `${apiBase}/api/flags?userId=${encodeURIComponent(uid)}&provider=${encodeURIComponent(providerChoice)}`
      );
      await r.json();
    } catch {
      // ignore (backend may be using a different provider or be offline)
    }
  }, [providerChoice]);

  const setUserAndRefresh = useCallback(async () => {
    // Set BOTH targetingKey (for flagd/OpenFeature targeting) and userId (for other providers)
    await OpenFeature.setContext({ targetingKey: userId, userId });

    await refreshFE();
    await refreshBE(userId);
  }, [userId, refreshFE, refreshBE]);

  useEffect(() => {
    (async () => {
      const client = await initOpenFeature(); // picks the chosen provider
      setOfClient(client);

      // Set initial context
      await OpenFeature.setContext({ targetingKey: 'anonymous', userId: 'anonymous' });

      await refreshFE();
      await refreshBE('anonymous');

      const onReady = () => refreshFE();
      const onChanged = () => refreshFE();
      const h1 = OpenFeature.addHandler?.(ProviderEvents.Ready, onReady);
      const h2 = OpenFeature.addHandler?.(ProviderEvents.ConfigurationChanged, onChanged);

      return () => {
        h1?.remove?.();
        h2?.remove?.();
      };
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Small helper to add an 8s timeout + consistent error surface
  async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, Arial, sans-serif' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12
      }}>
        <h1 style={{ margin: 0 }}>OpenFeature + flag providers (Frontend + Backend)</h1>
        <button
          onClick={() => {
            localStorage.removeItem('providerChoice');
            window.location.reload();
          }}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}
        >
          Switch provider
        </button>
      </div>

      <div style={{ margin: '12px 0' }}>
        <label>
          userId:{' '}
          <input value={userId} onChange={(e) => setUserId(e.target.value)} />
        </label>
        <button onClick={setUserAndRefresh} style={{ marginLeft: 8 }}>
          Refresh (FE + BE)
        </button>
      </div>

      <h2>Frontend‑evaluated flags</h2>
      <div style={{ margin: '8px 0' }}>
        <span>Product Title</span>
        {flags.newBadge && (
          <span style={{
            padding: '2px 8px', borderRadius: 999, background: '#eee', marginLeft: 8
          }}>NEW</span>
        )}
      </div>

      <div>
        <button
          style={{
            padding: '10px 16px',
            border: 'none',
            borderRadius: 8,
            color: 'white',
            background: flags.ctaColor === 'green' ? '#10b981' : '#3b82f6'
          }}
        >
          CTA Button ({flags.ctaColor})
        </button>
      </div>

      <h2 style={{ marginTop: 24 }}>Backend‑gated endpoints</h2>
      <div>
        <button onClick={async () => {
          const url = `${apiBase}/api/hello?userId=${encodeURIComponent(userId)}&provider=${encodeURIComponent(providerChoice)}`;
          try {
            const r = await fetchWithTimeout(url);
            const body = r.ok
              ? await r.json()
              : { error: `HTTP ${r.status}`, ...(await r.json().catch(() => ({}))) };
            alert(JSON.stringify(body, null, 2));
          } catch (err) {
            alert(`Request failed: ${url}\n\n${err?.message || String(err)}`);
          }
        }}>Call /api/hello</button>

        <button style={{ marginLeft: 8 }} onClick={async () => {
          const url = `${apiBase}/api/secret?userId=${encodeURIComponent(userId)}&provider=${encodeURIComponent(providerChoice)}`;
          try {
            const r = await fetchWithTimeout(url);
            const body = r.ok
              ? await r.json()
              : { error: `HTTP ${r.status}`, ...(await r.json().catch(() => ({}))) };
            alert(JSON.stringify(body, null, 2));
          } catch (err) {
            alert(`Request failed: ${url}\n\n${err?.message || String(err)}`);
          }
        }}>Call /api/secret</button>
      </div>
    </div>
  );
}