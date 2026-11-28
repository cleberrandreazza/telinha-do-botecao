import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isTauriDesktop } from './lib/utils';
import './index.css';

type EditableField = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** Campo em que copiar e colar fazem sentido. O menu nativo do WebView não abre. */
function editableField(target: EventTarget | null): EditableField | null {
  let node: Node | null = target instanceof Node ? target : null;
  while (node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      if (node.disabled || node.readOnly) return null;
      return node;
    }
    if (node instanceof HTMLElement && node.isContentEditable) return node;
    node = node.parentElement;
  }
  return null;
}

function fieldHasSelection(field: EditableField): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    return start !== end;
  }
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

let editMenu: HTMLDivElement | null = null;

function closeEditMenu() {
  editMenu?.remove();
  editMenu = null;
}

function runEditCommand(command: 'cut' | 'copy' | 'paste' | 'selectAll') {
  document.execCommand(command);
  closeEditMenu();
}

/** Recortar, copiar, colar e selecionar. Sem Inspecionar nem More tools. */
function openEditMenu(x: number, y: number, field: EditableField) {
  closeEditMenu();
  const selected = fieldHasSelection(field);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.className = 'fixed z-[80] min-w-[11rem] rounded-xl border border-[#272a37] bg-[#111318]/95 p-1 text-[13px] text-on-surface shadow-2xl backdrop-blur-xl';
  const items: Array<{ label: string; command: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }> = [
    { label: 'Recortar', command: 'cut', enabled: selected },
    { label: 'Copiar', command: 'copy', enabled: selected },
    { label: 'Colar', command: 'paste', enabled: true },
    { label: 'Selecionar tudo', command: 'selectAll', enabled: true },
  ];
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    button.textContent = item.label;
    button.disabled = !item.enabled;
    button.className = 'flex w-full items-center rounded-lg px-3 py-1.5 text-left hover:bg-white/10 disabled:cursor-default disabled:text-white/35 disabled:hover:bg-transparent';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => runEditCommand(item.command));
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  editMenu = menu;
}

if (isTauriDesktop()) {
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const field = editableField(event.target);
    if (!field) {
      closeEditMenu();
      return;
    }
    openEditMenu(event.clientX, event.clientY, field);
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (editMenu && !editMenu.contains(event.target as Node)) closeEditMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditMenu();
  });
  window.addEventListener('blur', closeEditMenu);
  window.addEventListener('scroll', closeEditMenu, true);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
