// frontend/src/index.js
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ProviderChooser from './ui/ProviderChooser';
import { PROVIDER_STORAGE_KEY } from './providers/registry';
import './index.css';

function Root() {
  const [choice, setChoice] = useState(
    localStorage.getItem(PROVIDER_STORAGE_KEY)
  );

  if (!choice) {
    return (
      <ProviderChooser
        onChosen={(id) => {
          // Persist and navigate to the app. App will initialize provider.
          localStorage.setItem(PROVIDER_STORAGE_KEY, id);
          setChoice(id);
        }}
      />
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);