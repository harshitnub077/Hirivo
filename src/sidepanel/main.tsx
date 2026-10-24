import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { App } from './App';

// Dark is the default; the saved theme (if any) is applied by App once settings load.
document.documentElement.dataset.theme = 'dark';

async function start() {
  if (import.meta.env.DEV && location.search.includes('demo')) await (await import('./demo')).seedDemo();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

start();
