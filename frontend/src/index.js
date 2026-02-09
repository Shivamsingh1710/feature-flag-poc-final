import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ProviderChooser from './ui/ProviderChooser';
import { PROVIDER_STORAGE_KEY, DEFAULT_PROVIDER } from './providers/registry';
import './index.css';

function Root() {
  const [choice, setChoice] = useState(
    localStorage.getItem(PROVIDER_STORAGE_KEY)
  );

  if (!choice) {
    return (
      <ProviderChooser
        onChosen={(id) => {
          localStorage.setItem(PROVIDER_STORAGE_KEY, id);
          setChoice(id);
        }}
      />
    );
  }
  // Once choice is set, <App /> will initialize OpenFeature using that provider
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);