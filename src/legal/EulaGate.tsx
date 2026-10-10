import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Logo } from '../ui/components/Logo';
import { acceptEula, COPYRIGHT, EULA, EULA_TITLE, EULA_VERSION, eulaAccepted } from './eula';

export const eulaOk = signal(eulaAccepted());

/** The agreement text (used by the first-run gate and the "License agreement" dialog). */
export function EulaText() {
  return (
    <div class="eula-text">
      <p class="faint">Version {EULA_VERSION}</p>
      {EULA.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** First use (and after the agreement changes): read and accept before using Kinora. */
export function EulaGate() {
  const [agree, setAgree] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setReadToEnd(true);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    return () => el.removeEventListener('scroll', check);
  }, [declined]);
  if (eulaOk.value) return null;

  return (
    <div class="eula-gate" role="dialog" aria-modal="true" aria-labelledby="eula-title">
      <div class="eula-card">
        <div class="eula-head">
          <Logo size={36} />
          <div class="grow">
            <h2 id="eula-title">
              {declined ? 'Kinora needs your agreement' : 'Welcome to Kinora'}
            </h2>
            <p class="muted">
              {declined
                ? 'You can only use Kinora if you accept the license agreement.'
                : 'Before you start, please read and accept the license agreement.'}
            </p>
          </div>
        </div>
        {declined ? (
          <div class="eula-declined">
            <p>
              No problem — nothing has been saved or sent anywhere. You can close Kinora now, or
              read the agreement again.
            </p>
            <button class="btn primary" onClick={() => setDeclined(false)}>
              Read the agreement again
            </button>
          </div>
        ) : (
          <>
            <div class="eula-scroll" ref={box} tabIndex={0} aria-label={EULA_TITLE}>
              <h3 class="eula-doc-title">{EULA_TITLE}</h3>
              <EulaText />
            </div>
            <label class="eula-check">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree((e.target as HTMLInputElement).checked)}
              />
              <span>I have read and agree to the Kinora End User License Agreement.</span>
            </label>
            {!readToEnd && !agree && <p class="faint eula-hint">Scroll to read it all.</p>}
            <div class="eula-actions">
              <button class="btn ghost" onClick={() => setDeclined(true)}>
                Decline
              </button>
              <button
                class="btn primary"
                disabled={!agree}
                onClick={() => {
                  acceptEula();
                  eulaOk.value = true;
                }}
              >
                Agree and continue
              </button>
            </div>
          </>
        )}
        <p class="eula-copy faint">Kinora {COPYRIGHT}</p>
      </div>
    </div>
  );
}
