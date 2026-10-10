import { signal } from '@preact/signals';
import type { CanvasPreset } from '../../model/defaults';

export type AspectChoice = CanvasPreset | 'auto';

export type DialogState =
  | { type: 'export' }
  | { type: 'glossary'; term?: string }
  | { type: 'shortcuts' }
  | { type: 'settings' }
  | { type: 'eula' }
  | { type: 'account'; mode?: 'signin' | 'signup' | 'forgot' | 'reset'; token?: string }
  | { type: 'notices' }
  | { type: 'templates' }
  | {
      type: 'aspect';
      title: string;
      subtitle?: string;
      allowAuto: boolean;
      resolve: (choice: AspectChoice | null) => void;
    }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | { type: 'prompt'; title: string; label: string; value: string; resolve: (v: string | null) => void };

export const dialog = signal<DialogState | null>(null);

export function openDialog(d: DialogState): void {
  dialog.value = d;
}

export function closeDialog(): void {
  const d = dialog.peek();
  dialog.value = null;
  // Resolve pending promises as "cancelled".
  if (d?.type === 'aspect') d.resolve(null);
  if (d?.type === 'confirm') d.resolve(false);
  if (d?.type === 'prompt') d.resolve(null);
}

export function confirmDialog(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value = {
      type: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      danger: opts.danger,
      resolve,
    };
  });
}

export function promptDialog(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value = { type: 'prompt', title, label, value, resolve };
  });
}

export function pickAspect(title: string, subtitle?: string, allowAuto = true): Promise<AspectChoice | null> {
  return new Promise((resolve) => {
    dialog.value = { type: 'aspect', title, subtitle, allowAuto, resolve };
  });
}
