import React, { useEffect, useState, useCallback, useRef } from 'react';
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import { initOpenFeature } from './openfeature';
import { reloadGrowthBookFeatures } from './providers/growthbook';
import { reloadFlagsmithEnvironment } from './providers/flagsmith';

export default function App() {
  const [userId, setUserId] = useState('anonymous');
  const [flags, setFlags] = useState({ newBadge: false, ctaColor: 'blue' });

  // Keep the OpenFeature client in a ref to avoid stale closures in event handlers
  const clientRef = useRef(null);

  const apiBase = 'http://localhost:8000';
  const providerChoice = localStorage.getItem('providerChoice') || 'flagd';

  // Refresh FE flags using per-call context to avoid races with onContextChange
  const refreshFE = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    const ctx = { targetingKey: userId, userId }; // per-call context
    const newBadge = await client.getBooleanValue('new-badge', false, ctx);
    const ctaColor = await client.getStringValue('cta-color', 'blue', ctx);
    setFlags({ newBadge, ctaColor });
  }, [userId]);

  // Ping backend flags (used by the LD-backend provider and for parity checks)
  const refreshBE = useCallback(
    async (uid) => {
      try {
        const r = await fetch(
          `${apiBase}/api/flags?userId=${encodeURIComponent(uid)}&provider=${encodeURIComponent(providerChoice)}`
        );
        await r.json();
      } catch {
        // ignore (backend may be using a different provider or be offline)
      }
    },
    [providerChoice]
  );

  // Set user and refresh both FE + BE
  const setUserAndRefresh = useCallback(async () => {
    // 1) For GB & Flagsmith, explicitly reload their JSON so FE gets latest file
    if (providerChoice === 'growthbook') {
      await reloadGrowthBookFeatures();
    } else if (providerChoice === 'flagsmith') {
      await reloadFlagsmithEnvironment();
    }
    // 2) Update global context (good hygiene for all providers)
    await OpenFeature.setContext({ targetingKey: userId, userId });
    // 3) Re-evaluate immediately (per-call context avoids race)
    await refreshFE();
    await refreshBE(userId);
  }, [userId, providerChoice, refreshFE, refreshBE]);

  useEffect(() => {
    let removeReady;
    let removeChanged;
    let cancelled = false;

    (async () => {
      // Initialize provider chosen in the chooser
      const client = await initOpenFeature();
      if (cancelled) return;
      clientRef.current = client;

      // Set initial context
      await OpenFeature.setContext({ targetingKey: 'anonymous', userId: 'anonymous' });
      if (cancelled) return;

      // Initial refresh (FE first so UI syncs right away) using per-call context
      await refreshFE();
      await refreshBE('anonymous');
      if (cancelled) return;

      // Subscribe to provider lifecycle events; use ref-based refresh; per-call context inside refreshFE
      const onReady = () => {
        // Some providers emit Ready immediately; microtask tick + refresh to be safe
        Promise.resolve().then(() => refreshFE());
      };
      const onChanged = () => {
        refreshFE();
      };

      removeReady = OpenFeature.addHandler?.(ProviderEvents.Ready, onReady);
      removeChanged = OpenFeature.addHandler?.(ProviderEvents.ConfigurationChanged, onChanged);
    })();

    // Proper cleanup returned directly from useEffect
    return () => {
      cancelled = true;
      try { removeReady?.remove?.(); } catch {}
      try { removeChanged?.remove?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

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