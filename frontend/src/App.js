// frontend/src/App.js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import { initOpenFeature, reinitOpenFeature } from './openfeature';
import { reloadGrowthBookFeatures } from './providers/growthbook';
import { reloadFlagsmithEnvironment } from './providers/flagsmith';
import { refreshFlagsmithOnline } from './providers/flagsmith_online';

export default function App() {
  const [userId, setUserId] = useState('anonymous');
  const [flags, setFlags] = useState({ newBadge: false, ctaColor: 'blue' });

  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const apiBase = 'http://localhost:8000';
  const providerChoice = localStorage.getItem('providerChoice') || 'flagd';

  const backendProviderFor = (choice) => {
    if (choice === 'flagsmith-online') return 'flagsmith-online';
    if (choice === 'flagsmith-offline') return 'flagsmith';
    return choice;
  };

  const refreshFE = useCallback(async () => {
    try {
      const client = await OpenFeature.getClient('frontend'); // fetch fresh client every time
      const uid = userIdRef.current;
      const ctx = { targetingKey: uid, userId: uid };
      const [newBadge, ctaColor] = await Promise.all([
        client.getBooleanValue('new-badge', false, ctx),
        client.getStringValue('cta-color', 'blue', ctx),
      ]);
      setFlags({ newBadge, ctaColor });
      // eslint-disable-next-line no-console
      console.log('[FE] refreshFE ->', { uid, newBadge, ctaColor });
      if (typeof window !== 'undefined') window.__feLast = { uid, newBadge, ctaColor };
    } catch (e) {
      console.warn('[FE] refreshFE error:', e);
    }
  }, []);

  const refreshBE = useCallback(
    async (uid) => {
      try {
        const provider = backendProviderFor(providerChoice);
        const r = await fetch(
          `${apiBase}/api/flags?userId=${encodeURIComponent(uid)}&provider=${encodeURIComponent(provider)}`
        );
        await r.json();
      } catch {
        // ignore
      }
    },
    [providerChoice]
  );

  const setUserAndRefresh = useCallback(async () => {
    if (providerChoice === 'growthbook') {
      await reloadGrowthBookFeatures();
    } else if (providerChoice === 'flagsmith-offline') {
      await reloadFlagsmithEnvironment();
    } else if (providerChoice === 'flagsmith-online') {
      await refreshFlagsmithOnline();
    }

    await OpenFeature.setContext({ targetingKey: userIdRef.current, userId: userIdRef.current });
    await refreshFE();
    await refreshBE(userIdRef.current);
  }, [providerChoice, refreshFE, refreshBE]);

  useEffect(() => {
    let removeReady;
    let removeChanged;
    let cancelled = false;

    (async () => {
      // Initialize provider chosen in the chooser
      try {
        await initOpenFeature();
      } catch (e) {
        console.error('[App] initOpenFeature failed, falling back to flagd:', e);
        // fallback to flagd so the app opens
        localStorage.setItem('providerChoice', 'flagd');
        await reinitOpenFeature();
      }
      if (cancelled) return;

      await OpenFeature.setContext({ targetingKey: userIdRef.current, userId: userIdRef.current });
      if (cancelled) return;

      await refreshFE();
      await refreshBE(userIdRef.current);
      if (cancelled) return;

      const onReady = () => Promise.resolve().then(() => refreshFE());
      const onChanged = () => refreshFE();

      removeReady = OpenFeature.addHandler?.(ProviderEvents.Ready, onReady);
      removeChanged = OpenFeature.addHandler?.(ProviderEvents.ConfigurationChanged, onChanged);
    })();

    return () => {
      cancelled = true;
      try { removeReady?.remove?.(); } catch {}
      try { removeChanged?.remove?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc', marginBottom: 12 }}>
        <div style={{ fontSize: 13 }}>
          <strong>Provider:</strong> {localStorage.getItem('providerChoice')}
          {'  '}|{'  '}<strong>userId:</strong> {userId}
          {'  '}|{'  '}<strong>FE reads:</strong> new-badge={String(flags.newBadge)}, cta-color={flags.ctaColor}
        </div>
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
          const provider = backendProviderFor(providerChoice);
          const url = `${apiBase}/api/hello?userId=${encodeURIComponent(userIdRef.current)}&provider=${encodeURIComponent(provider)}`;
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
          const provider = backendProviderFor(providerChoice);
          const url = `${apiBase}/api/secret?userId=${encodeURIComponent(userIdRef.current)}&provider=${encodeURIComponent(provider)}`;
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