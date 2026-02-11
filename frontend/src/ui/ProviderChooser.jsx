// frontend/src/ui/ProviderChooser.jsx
import React, { useState } from 'react';
import { PROVIDERS } from '../providers/registry';

/**
 * Inline submenu (B2) for Flagsmith:
 * - Top-level options: flagd, GrowthBook, Flagsmith, LaunchDarkly
 * - When "Flagsmith" is selected, shows inline radio for:
 *    - Flagsmith (Offline JSON)
 *    - Flagsmith (Online API)
 *
 * onChosen receives the final provider id:
 *  - 'flagd' | 'growthbook' | 'launchdarkly'
 *  - 'flagsmith-offline' | 'flagsmith-online'
 */
export default function ProviderChooser({ onChosen }) {
  const [selectedTop, setSelectedTop] = useState(null); // 'flagd' | 'growthbook' | 'flagsmith' | 'launchdarkly'
  const [flagsmithMode, setFlagsmithMode] = useState(null); // 'flagsmith-offline' | 'flagsmith-online'

  const canContinue =
    (selectedTop && selectedTop !== 'flagsmith') ||
    (selectedTop === 'flagsmith' && (flagsmithMode === 'flagsmith-offline' || flagsmithMode === 'flagsmith-online'));

  const topLabel = (id) => {
    if (id === 'flagd') return PROVIDERS['flagd'].label;
    if (id === 'growthbook') return PROVIDERS['growthbook'].label;
    if (id === 'launchdarkly') return PROVIDERS['launchdarkly'].label;
    if (id === 'flagsmith') return 'Flagsmith';
    return id;
  };

  const handleContinue = () => {
    if (!canContinue) return;
    if (selectedTop === 'flagsmith') {
      onChosen(flagsmithMode);
    } else {
      onChosen(selectedTop);
    }
  };

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
          width: 560,
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
          {/* flagd */}
          <label
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
              name="provider-top"
              value="flagd"
              onChange={() => setSelectedTop('flagd')}
              checked={selectedTop === 'flagd'}
              style={{ marginRight: 10 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{topLabel('flagd')}</div>
              <div style={{ color: '#666', fontSize: 13 }}>
                Reads flags from your local flagd daemon (JSON).
              </div>
            </div>
          </label>

          {/* GrowthBook */}
          <label
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
              name="provider-top"
              value="growthbook"
              onChange={() => setSelectedTop('growthbook')}
              checked={selectedTop === 'growthbook'}
              style={{ marginRight: 10 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{topLabel('growthbook')}</div>
              <div style={{ color: '#666', fontSize: 13 }}>
                Evaluates flags locally from /growthbook/features.json.
              </div>
            </div>
          </label>

          {/* Flagsmith (inline submenu) */}
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="provider-top"
                value="flagsmith"
                onChange={() => setSelectedTop('flagsmith')}
                checked={selectedTop === 'flagsmith'}
                style={{ marginRight: 10 }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{topLabel('flagsmith')}</div>
                <div style={{ color: '#666', fontSize: 13 }}>
                  Choose Offline JSON or Online API.
                </div>
              </div>
            </label>

            {selectedTop === 'flagsmith' && (
              <div style={{ marginTop: 12, paddingLeft: 28 }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="flagsmith-mode"
                    value="flagsmith-offline"
                    onChange={() => setFlagsmithMode('flagsmith-offline')}
                    checked={flagsmithMode === 'flagsmith-offline'}
                    style={{ marginRight: 8 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {PROVIDERS['flagsmith-offline'].label}
                    </div>
                    <div style={{ color: '#666', fontSize: 13 }}>
                      Evaluates via Flagsmith using a static environment.json (offline).
                    </div>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="flagsmith-mode"
                    value="flagsmith-online"
                    onChange={() => setFlagsmithMode('flagsmith-online')}
                    checked={flagsmithMode === 'flagsmith-online'}
                    style={{ marginRight: 8 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {PROVIDERS['flagsmith-online'].label}
                    </div>
                    <div style={{ color: '#666', fontSize: 13 }}>
                      Evaluates via Flagsmith Cloud/API using your client-side environment ID.
                    </div>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* LaunchDarkly */}
          <label
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
              name="provider-top"
              value="launchdarkly"
              onChange={() => setSelectedTop('launchdarkly')}
              checked={selectedTop === 'launchdarkly'}
              style={{ marginRight: 10 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{topLabel('launchdarkly')}</div>
              <div style={{ color: '#666', fontSize: 13 }}>
                Evaluates via backend using LaunchDarkly offline json file.
              </div>
            </div>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <button
            disabled={!canContinue}
            onClick={handleContinue}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: canContinue ? '#3b82f6' : '#9ca3af',
              color: 'white',
              cursor: canContinue ? 'pointer' : 'not-allowed',
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