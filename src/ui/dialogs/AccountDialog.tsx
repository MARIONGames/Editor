import { useState } from 'preact/hooks';
import {
  Copy,
  CloudOff,
  CloudUpload,
  KeyRound,
  LifeBuoy,
  LogOut,
  RefreshCw,
  Trash2,
  UserRound,
} from 'lucide-preact';
import { ApiError, OfflineError } from '../../account/api';
import { BACKUP_ENABLED } from '../../account/config';
import {
  account,
  changePassword,
  deleteAccount,
  newRecoveryCode,
  recoverAccount,
  rename,
  signIn,
  signOut,
  signUp,
  usage,
} from '../../account/session';
import { autoBackup, setAutoBackup, syncLabel, syncNow, syncState } from '../../account/sync';
import { toast } from '../../state/store';
import { Dialog } from '../components/Dialog';
import { Switch } from '../components/Controls';
import { closeDialog, openDialog } from './dialogState';

export type AccountMode = 'signin' | 'signup' | 'recover';

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof OfflineError) return err.message;
  return 'Something went wrong. Please try again.';
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.ceil(bytes / 1024))} KB`;
}

export function AccountDialog(props: { mode?: AccountMode }) {
  // A fresh recovery code is shown once, right after sign-up or recovery.
  const [code, setCode] = useState<string | null>(null);
  if (code) return <RecoveryCodeView code={code} onDone={closeDialog} />;
  if (account.value) return <AccountView onCode={setCode} />;
  return <SignInView initial={props.mode ?? 'signin'} onCode={setCode} />;
}

/** Shows a recovery code with a copy button. People need it if they forget their password. */
function RecoveryCodeView(props: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      toast('Recovery code copied', 'success');
    } catch {
      toast('Couldn’t copy — please write it down.', 'info');
    }
  };
  return (
    <Dialog
      title="Save your recovery code"
      subtitle="If you ever forget your password, this code lets you back in. Nobody else can reset it for you."
      onClose={props.onDone}
    >
      <div class="recovery">
        <code class="recovery-code" aria-label="Recovery code">
          {props.code}
        </code>
        <button class="btn small" onClick={() => void copy()}>
          <Copy size={16} /> Copy
        </button>
        <p class="faint">
          Write it down or keep it in a password manager. It works once; you get a new one each time
          you use it.
        </p>
        <label class="eula-check">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved((e.target as HTMLInputElement).checked)}
          />
          <span>I’ve saved my recovery code</span>
        </label>
        <button class="btn primary block" disabled={!saved} onClick={props.onDone}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function SignInView(props: { initial: AccountMode; onCode: (c: string) => void }) {
  const [mode, setMode] = useState<AccountMode>(props.initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        toast('Signed in.', 'success');
        closeDialog();
      } else if (mode === 'signup') {
        props.onCode(await signUp(name, email, password));
        toast('Account created.', 'success');
      } else {
        props.onCode(await recoverAccount(email, code, password));
        toast('New password saved. You’re signed in.', 'success');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signup'
      ? 'Create your Kinora account'
      : mode === 'recover'
        ? 'Forgot your password?'
        : 'Sign in to Kinora';
  return (
    <Dialog
      title={title}
      subtitle="Optional. Kinora works fully without an account, offline too."
      onClose={closeDialog}
    >
      <form class="account-form" onSubmit={(e) => void submit(e)}>
        {mode === 'signup' && (
          <label class="field">
            <span class="field-label">Your name</span>
            <input
              class="input"
              autoComplete="name"
              required
              maxLength={60}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        <label class="field">
          <span class="field-label">Email</span>
          <input
            class="input"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </label>
        {mode === 'recover' && (
          <label class="field">
            <span class="field-label">Recovery code</span>
            <input
              class="input recovery-input"
              autoComplete="off"
              spellcheck={false}
              required
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              maxLength={40}
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            <small class="faint">The code you saved when you created your account.</small>
          </label>
        )}
        <label class="field">
          <span class="field-label">{mode === 'recover' ? 'New password' : 'Password'}</span>
          <input
            class="input"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signin' ? 1 : 8}
            maxLength={200}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
          {mode !== 'signin' && (
            <small class="faint">
              At least 8 characters. A short sentence is easy to remember and hard to guess.
            </small>
          )}
        </label>
        {mode === 'signup' && (
          <p class="faint account-legal">
            By creating an account you agree to the{' '}
            <button type="button" class="link-btn" onClick={() => openDialog({ type: 'eula' })}>
              License agreement
            </button>
            . Your projects stay on this device.
          </p>
        )}
        {error && (
          <p class="account-error" role="alert">
            {error}
          </p>
        )}
        <button class="btn primary block" type="submit" disabled={busy}>
          {busy
            ? 'One moment…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'recover'
                ? 'Set new password'
                : 'Sign in'}
        </button>
        <div class="account-switch">
          {mode === 'signin' ? (
            <>
              <button type="button" class="link-btn" onClick={() => setMode('signup')}>
                New here? Create an account
              </button>
              <button type="button" class="link-btn" onClick={() => setMode('recover')}>
                Forgot password?
              </button>
            </>
          ) : (
            <button type="button" class="link-btn" onClick={() => setMode('signin')}>
              {mode === 'signup' ? 'I already have an account' : 'Back to sign in'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function AccountView(props: { onCode: (c: string) => void }) {
  const acc = account.value!;
  const st = syncState.value;
  const u = usage.value;
  const [panel, setPanel] = useState<'none' | 'name' | 'password' | 'code' | 'delete'>('none');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) toast(done, 'success');
      setPanel('none');
      setA('');
      setB('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const open = (p: typeof panel) => {
    setPanel(panel === p ? 'none' : p);
    setA(p === 'name' ? acc.user.name : '');
    setB('');
    setError(null);
  };

  return (
    <Dialog title="Your account" subtitle={acc.user.email} onClose={closeDialog}>
      <div class="account-view">
        <div class="account-card">
          <span class="account-avatar">
            {acc.user.name.slice(0, 1).toUpperCase() || <UserRound size={22} />}
          </span>
          <div class="grow">
            <strong>{acc.user.name}</strong>
            {BACKUP_ENABLED ? (
              <span class={`sync-line status-${st.status}`}>
                {st.status === 'offline' ? <CloudOff size={15} /> : <CloudUpload size={15} />}{' '}
                {syncLabel(st)}
              </span>
            ) : (
              <span class="sync-line">Your projects are saved on this device</span>
            )}
          </div>
          {BACKUP_ENABLED && (
            <button
              class="icon-btn"
              title="Back up now"
              aria-label="Back up now"
              disabled={st.status === 'syncing' || !autoBackup.value}
              onClick={() => void syncNow()}
            >
              <RefreshCw size={18} class={st.status === 'syncing' ? 'spin' : ''} />
            </button>
          )}
        </div>
        {BACKUP_ENABLED && (
          <>
            {st.message && <p class="faint">{st.message}</p>}
            {u && (
              <div class="usage">
                <div class="usage-bar">
                  <span style={{ width: `${Math.min(100, (u.bytes / u.quota) * 100)}%` }} />
                </div>
                <span class="faint">
                  {size(u.bytes)} of {size(u.quota)} cloud storage used
                </span>
              </div>
            )}
            <Switch
              label="Back up automatically"
              hint="Projects on this device are copied to your account and appear on your other devices. Kinora still saves everything here first and works offline."
              checked={autoBackup.value}
              onChange={setAutoBackup}
            />
          </>
        )}

        <div class="account-actions">
          <button class="btn small" onClick={() => open('name')}>
            <UserRound size={16} /> Change name
          </button>
          <button class="btn small" onClick={() => open('password')}>
            <KeyRound size={16} /> Change password
          </button>
          <button class="btn small" onClick={() => open('code')}>
            <LifeBuoy size={16} /> New recovery code
          </button>
          <button
            class="btn small"
            onClick={() => {
              void signOut();
              toast('Signed out. Your projects stay on this device.', 'info');
              closeDialog();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>

        {panel === 'name' && (
          <form
            class="account-form"
            onSubmit={(e) => (e.preventDefault(), void run(() => rename(a.trim()), 'Name changed'))}
          >
            <input
              class="input"
              autoFocus
              maxLength={60}
              value={a}
              onInput={(e) => setA((e.target as HTMLInputElement).value)}
              aria-label="Your name"
            />
            <button class="btn primary small" type="submit" disabled={busy || !a.trim()}>
              Save
            </button>
          </form>
        )}
        {panel === 'password' && (
          <form
            class="account-form"
            onSubmit={(e) => (
              e.preventDefault(),
              void run(
                () => changePassword(a, b),
                'Password changed. Other devices need to sign in again.',
              )
            )}
          >
            <input
              class="input"
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              required
              value={a}
              onInput={(e) => setA((e.target as HTMLInputElement).value)}
            />
            <input
              class="input"
              type="password"
              autoComplete="new-password"
              placeholder="New password (8+ characters)"
              required
              minLength={8}
              value={b}
              onInput={(e) => setB((e.target as HTMLInputElement).value)}
            />
            <button class="btn primary small" type="submit" disabled={busy}>
              Change password
            </button>
          </form>
        )}
        {panel === 'code' && (
          <form
            class="account-form"
            onSubmit={(e) => (
              e.preventDefault(),
              void run(async () => props.onCode(await newRecoveryCode(a)))
            )}
          >
            <p class="faint">Lost your recovery code? Make a new one; the old one stops working.</p>
            <input
              class="input"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
              value={a}
              onInput={(e) => setA((e.target as HTMLInputElement).value)}
            />
            <button class="btn primary small" type="submit" disabled={busy}>
              Make a new recovery code
            </button>
          </form>
        )}
        {panel === 'delete' && (
          <form
            class="account-form danger-zone"
            onSubmit={(e) => (
              e.preventDefault(),
              void run(
                async () => (await deleteAccount(a), closeDialog()),
                'Account deleted. Your projects are still on this device.',
              )
            )}
          >
            <p>
              This deletes your account. Projects on this device are not touched. This can’t be
              undone.
            </p>
            <input
              class="input"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
              value={a}
              onInput={(e) => setA((e.target as HTMLInputElement).value)}
            />
            <button class="btn danger small" type="submit" disabled={busy}>
              Delete my account
            </button>
          </form>
        )}
        {error && (
          <p class="account-error" role="alert">
            {error}
          </p>
        )}
        {panel !== 'delete' && (
          <button class="btn ghost small danger-link" onClick={() => open('delete')}>
            <Trash2 size={15} /> Delete account
          </button>
        )}
      </div>
    </Dialog>
  );
}
