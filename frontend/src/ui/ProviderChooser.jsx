// frontend/src/ui/ProviderChooser.jsx
import React, { useState } from 'react';
import { PROVIDERS } from '../providers/registry';

export default function ProviderChooser({ onChosen }) {
  const [selected, setSelected] = useState(null);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: 520,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Choose a Feature Flag Provider</h2>
        <p style={{ color: '#555', marginTop: 8 }}>
          The app UI is identical; only the OpenFeature <em>provider</em> changes.
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {Object.values(PROVIDERS).map((p) => (
            <label
              key={p.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="provider"
                value={p.id}
                onChange={() => setSelected(p.id)}
                checked={selected === p.id}
                style={{ marginRight: 10 }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ color: '#666', fontSize: 13 }}>
                  {p.id === 'flagd' &&
                    'Reads flags from your local flagd daemon (JSON).'}
                  {p.id === 'growthbook' &&
                    'Evaluates flags locally from /growthbook/features.json.'}
                  {p.id === 'flagsmith' &&
                    'Evaluates via Flagsmith Hosted API using your Environment ID.'}
                  {p.id === 'launchdarkly' &&
                    'Evaluates via backend using LaunchDarkly offline file datasource (no cloud).'}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <button
            disabled={!selected}
            onClick={() => selected && onChosen(selected)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: selected ? '#3b82f6' : '#9ca3af',
              color: 'white',
              cursor: selected ? 'pointer' : 'not-allowed',
            }}
          >
            Continue
          </button>
        </div>

        <div style={{ marginTop: 12, color: '#777', fontSize: 12 }}>
          You can switch providers later from the app header.
        </div>
      </div>
    </div>
  );
}
