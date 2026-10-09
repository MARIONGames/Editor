import { CircleAlert, CircleCheck, Info, X } from 'lucide-preact';
import { busy, dismissToast, toasts } from '../../state/store';

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert size={18} /> : t.kind === 'success' ? <CircleCheck size={18} /> : <Info size={18} />}
          <span class="grow">{t.message}</span>
          {t.action && (
            <button
              class="btn small ghost"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button class="icon-btn small" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const b = busy.value;
  if (!b) return null;
  return (
    <div class="busy-backdrop">
      <div class="busy-card" role="alertdialog" aria-label={b.message}>
        <div class="spinner" />
        <div class="busy-msg">{b.message}</div>
        {b.progress !== null && (
          <div class="progress">
            <div class="progress-fill" style={{ width: `${Math.round(b.progress * 100)}%` }} />
          </div>
        )}
        {b.cancel && (
          <button class="btn small ghost" onClick={() => b.cancel?.()}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
