// frontend/src/ui/ProviderChooser.jsx
import React, { useState } from 'react';
import { PROVIDERS } from '../providers/registry';

/**
 * Inline submenu for Flagsmith and LaunchDarkly:
 * - Top: flagd, GrowthBook, Flagsmith, LaunchDarkly
 * - GrowthBook: offline only
 * - Flagsmith: offline vs online
 * - LaunchDarkly: offline vs online
 *
 * onChosen receives one of:
 * 'flagd' | 'growthbook' |
 * 'flagsmith-offline' | 'flagsmith-online' |
 * 'launchdarkly' | 'launchdarkly-online'
 */
export default function ProviderChooser({ onChosen }) {
  const [selectedTop, setSelectedTop] = useState(null); // 'flagd' | 'growthbook' | 'flagsmith' | 'launchdarkly'
  const [flagsmithMode, setFlagsmithMode] = useState(null); // 'flagsmith-offline' | 'flagsmith-online'
  const [ldMode, setLdMode] = useState(null); // 'launchdarkly' | 'launchdarkly-online'

  const canContinue =
    (selectedTop &&
      selectedTop !== 'flagsmith' &&
      selectedTop !== 'launchdarkly') ||
    (selectedTop === 'flagsmith' &&
      (flagsmithMode === 'flagsmith-offline' || flagsmithMode === 'flagsmith-online')) ||
    (selectedTop === 'launchdarkly' &&
      (ldMode === 'launchdarkly' || ldMode === 'launchdarkly-online'));

  const topLabel = (id) => {
    if (id === 'flagd') return PROVIDERS['flagd'].label;
    if (id === 'growthbook') return PROVIDERS['growthbook'].label;
    if (id === 'launchdarkly') return 'LaunchDarkly';
    if (id === 'flagsmith') return 'Flagsmith';
    return id;
  };

  const handleContinue = () => {
    if (!canContinue) return;
    if (selectedTop === 'flagsmith') {
      onChosen(flagsmithMode);
    } else if (selectedTop === 'launchdarkly') {
      onChosen(ldMode);
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

          {/* GrowthBook (offline only) */}
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
                <div style={{ fontWeight: 600 }}>Flagsmith</div>
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

          {/* LaunchDarkly (inline submenu) */}
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
                value="launchdarkly"
                onChange={() => setSelectedTop('launchdarkly')}
                checked={selectedTop === 'launchdarkly'}
                style={{ marginRight: 10 }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>LaunchDarkly</div>
                <div style={{ color: '#666', fontSize: 13 }}>
                  Choose Offline (via backend file) or Online (browser SDK).
                </div>
              </div>
            </label>

            {selectedTop === 'launchdarkly' && (
              <div style={{ marginTop: 12, paddingLeft: 28 }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="ld-mode"
                    value="launchdarkly"
                    onChange={() => setLdMode('launchdarkly')}
                    checked={ldMode === 'launchdarkly'}
                    style={{ marginRight: 8 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {PROVIDERS['launchdarkly'].label}
                    </div>
                    <div style={{ color: '#666', fontSize: 13 }}>
                      Evaluates via backend using LaunchDarkly offline JSON file.
                    </div>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="ld-mode"
                    value="launchdarkly-online"
                    onChange={() => setLdMode('launchdarkly-online')}
                    checked={ldMode === 'launchdarkly-online'}
                    style={{ marginRight: 8 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {PROVIDERS['launchdarkly-online'].label}
                    </div>
                    <div style={{ color: '#666', fontSize: 13 }}>
                      Uses LaunchDarkly browser SDK with your client-side ID.
                    </div>
                  </div>
                </label>
              </div>
            )}
          </div>
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