let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'mb-toast-stack';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, kind: 'success' | 'error' | 'info' = 'info', ms = 4000): void {
  const stack = ensureContainer();
  const el = document.createElement('div');
  el.className = `mb-toast mb-toast-${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
