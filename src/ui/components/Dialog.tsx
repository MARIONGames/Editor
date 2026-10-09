import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';

/** Modal dialog: a centred card on desktop, a bottom sheet on phones. */
export function Dialog(props: {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, button.primary, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        class={`dialog ${props.wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.label ?? (typeof props.title === 'string' ? props.title : undefined)}
        ref={ref}
      >
        <div class="dialog-head">
          <div class="grow">
            <h2>{props.title}</h2>
            {props.subtitle && <p class="muted dialog-sub">{props.subtitle}</p>}
          </div>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div class="dialog-body scroll-y">{props.children}</div>
        {props.footer && <div class="dialog-foot">{props.footer}</div>}
      </div>
    </div>
  );
}
