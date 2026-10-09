import { render } from 'preact';
// Swapped for an empty stylesheet in the artifact demo build, which loads these fonts from Google Fonts.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/editor.css';
import './styles/timeline.css';
import './styles/panels.css';
import './styles/dialogs.css';
import { App } from './app/App';
import { initRouter } from './app/router';

function supported(): string | null {
  const c = document.createElement('canvas');
  if (!c.getContext('webgl2')) {
    return 'Kinora needs WebGL 2, which this browser or device does not support. Please try the latest Chrome, Edge, Safari or Firefox.';
  }
  if (typeof indexedDB === 'undefined') {
    return 'Kinora needs browser storage to keep your projects. Private/incognito mode may block it — please open Kinora in a normal window.';
  }
  return null;
}

const root = document.getElementById('app')!;
const problem = supported();
if (problem) {
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'unsupported';
  box.innerHTML = '<h1>Sorry!</h1><p></p>';
  box.querySelector('p')!.textContent = problem;
  root.appendChild(box);
} else {
  root.innerHTML = '';
  render(<App />, root);
  initRouter();
}

// Only the web build works offline through a service worker (the artifact and desktop builds don't use one).
if (import.meta.env.MODE === 'production' && 'serviceWorker' in navigator && window.isSecureContext && window.top === window) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
