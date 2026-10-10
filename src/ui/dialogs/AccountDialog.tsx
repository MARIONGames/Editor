import { useState } from 'preact/hooks';
import {
  CloudOff,
  CloudUpload,
  KeyRound,
  LogOut,
  RefreshCw,
  Trash2,
  UserRound,
} from 'lucide-preact';
import { ApiError, OfflineError } from '../../account/api';
import {
  account,
  changePassword,
  deleteAccount,
  forgotPassword,
  rename,
  resetPassword,
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

export type AccountMode = 'signin' | 'signup' | 'forgot' | 'reset';

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof OfflineError) return err.message;
  return 'Something went wrong. Please try again.';
}

function mb(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.ceil(bytes / 1024))} KB`;
}

export function AccountDialog(props: { mode?: AccountMode; resetToken?: string }) {
  const acc = account.value;
  if (acc && props.mode !== 'reset') return <AccountView />;
  return <SignInView initial={props.mode ?? 'signin'} resetToken={props.resetToken} />;
}

function SignInView(props: { initial: AccountMode; resetToken?: string }) {
  const [mode, setMode] = useState<AccountMode>(props.initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        toast('Signed in. Your projects will be backed up.', 'success');
        closeDialog();
      } else if (mode === 'signup') {
        await signUp(name, email, password);
        toast('Account created. Your projects will be backed up.', 'success');
        closeDialog();
      } else if (mode === 'forgot') {
        await forgotPassword(email);
        setSent(true);
      } else {
        await resetPassword(props.resetToken ?? '', password);
        toast('New password saved. You’re signed in.', 'success');
        closeDialog();
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
      : mode === 'forgot'
        ? 'Forgot your password?'
        : mode === 'reset'
          ? 'Choose a new password'
          : 'Sign in to Kinora';
  return (
    <Dialog
      title={title}
      subtitle="Optional. Kinora works fully without an account, offline too."
      onClose={closeDialog}
    >
      {mode === 'forgot' && sent ? (
        <div class="account-sent">
          <p>
            If there is an account for {email}, we’ve sent it a link to choose a new password. It
            works for one hour.
          </p>
          <button class="btn" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        </div>
      ) : (
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
          {mode !== 'reset' && (
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
          )}
          {mode !== 'forgot' && (
            <label class="field">
              <span class="field-label">{mode === 'reset' ? 'New password' : 'Password'}</span>
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
          )}
          {mode === 'signup' && (
            <p class="faint account-legal">
              By creating an account you agree to the{' '}
              <button type="button" class="link-btn" onClick={() => openDialog({ type: 'eula' })}>
                License agreement
              </button>
              . Your projects on this device are backed up to your account; you can turn this off.
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
                : mode === 'forgot'
                  ? 'Send me a link'
                  : mode === 'reset'
                    ? 'Save new password'
                    : 'Sign in'}
          </button>
          <div class="account-switch">
            {mode === 'signin' && (
              <>
                <button type="button" class="link-btn" onClick={() => setMode('signup')}>
                  New here? Create an account
                </button>
                <button type="button" class="link-btn" onClick={() => setMode('forgot')}>
                  Forgot password?
                </button>
              </>
            )}
            {(mode === 'signup' || mode === 'forgot') && (
              <button type="button" class="link-btn" onClick={() => setMode('signin')}>
                I already have an account
              </button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}

function AccountView() {
  const acc = account.value!;
  const st = syncState.value;
  const u = usage.value;
  const [panel, setPanel] = useState<'none' | 'name' | 'password' | 'delete'>('none');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(done, 'success');
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
            <span class={`sync-line status-${st.status}`}>
              {st.status === 'offline' ? <CloudOff size={15} /> : <CloudUpload size={15} />}{' '}
              {syncLabel(st)}
            </span>
          </div>
          <button
            class="icon-btn"
            title="Back up now"
            aria-label="Back up now"
            disabled={st.status === 'syncing' || !autoBackup.value}
            onClick={() => void syncNow()}
          >
            <RefreshCw size={18} class={st.status === 'syncing' ? 'spin' : ''} />
          </button>
        </div>
        {st.message && <p class="faint">{st.message}</p>}
        {u && (
          <div class="usage">
            <div class="usage-bar">
              <span style={{ width: `${Math.min(100, (u.bytes / u.quota) * 100)}%` }} />
            </div>
            <span class="faint">
              {mb(u.bytes)} of {mb(u.quota)} cloud storage used
            </span>
          </div>
        )}
        <Switch
          label="Back up automatically"
          hint="Projects on this device are copied to your account and appear on your other devices. Kinora still saves everything here first and works offline."
          checked={autoBackup.value}
          onChange={setAutoBackup}
        />

        <div class="account-actions">
          <button class="btn small" onClick={() => open('name')}>
            <UserRound size={16} /> Change name
          </button>
          <button class="btn small" onClick={() => open('password')}>
            <KeyRound size={16} /> Change password
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
              This deletes your account and <strong>everything backed up</strong> to it. Projects on
              this device are not touched. This can’t be undone.
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
