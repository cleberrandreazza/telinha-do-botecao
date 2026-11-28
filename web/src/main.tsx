import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isTauriDesktop } from './lib/utils';
import './index.css';

/** O menu do WebView2 fica só em campo editável, para copiar e colar. */
function allowsDesktopContextMenu(target: EventTarget | null): boolean {
  let node: Node | null = target instanceof Node ? target : null;
  while (node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return true;
    if (node instanceof HTMLElement && node.isContentEditable) return true;
    node = node.parentElement;
  }
  return false;
}

if (isTauriDesktop()) {
  document.addEventListener('contextmenu', (event) => {
    if (!allowsDesktopContextMenu(event.target)) event.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
