'use client';

import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Field, TextInput } from '../../../components/ui/Field';
import { Icon } from '../../../components/ui/Icon';
import { createClient } from '../../../lib/supabase/client';
import '../../login/login.css';

// Phase D — the set-password page. A worker arrives here from the recovery link in
// their invite / reset email (or an admin-shared link). The Supabase browser client
// parses the recovery token from the URL and opens a short-lived recovery session; the
// worker then chooses a password via auth.updateUser. On success they can sign in.
//
// Minimum password length mirrors supabase/config.toml (minimum_password_length = 6).
const MIN_PASSWORD_LENGTH = 6;

type Phase = 'checking' | 'ready' | 'no-session' | 'done';

export default function UpdatePasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Only a genuine RECOVERY arrival may set a password here. The recovery link carries
    // `type=recovery` in the URL hash; the client consumes it and fires PASSWORD_RECOVERY.
    // We deliberately do NOT treat a pre-existing normal session (an already-signed-in
    // user who happens to open this URL) as recovery — that would let them change their
    // own password with no re-auth. So: accept the form only on the PASSWORD_RECOVERY
    // event, or when a recovery session is already present AND the hash proves recovery.
    const hasRecoveryToken =
      typeof window !== 'undefined' && window.location.hash.includes('type=recovery');
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPhase('ready');
    });
    supabase.auth.getSession().then(({ data }) => {
      setPhase((p) => {
        if (p !== 'checking') return p; // the PASSWORD_RECOVERY event already resolved it
        if (!hasRecoveryToken) return 'no-session'; // not a recovery arrival
        // Recovery hash present: if the session already established (event fired before our
        // listener attached) show the form; otherwise stay checking and let the event flip it.
        return data.session !== null ? 'ready' : 'checking';
      });
    });
    // Safety net: a stale/invalid recovery token never establishes a session, so don't
    // hang on "Verifying" forever — fall back to the invalid-link message.
    const timeout = setTimeout(() => {
      setPhase((p) => (p === 'checking' ? 'no-session' : p));
    }, 5000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.');
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError !== null) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }
    setPhase('done');
    setSubmitting(false);
  }

  return (
    <main className="login">
      <section className="login-form-side" style={{ margin: '0 auto' }}>
        <div className="login-form col gap-6">
          <div className="login-form-lockup">
            <span className="login-mark">
              <Icon name="calendar" size={20} />
            </span>
            <span className="login-wordmark">
              Shift<span className="at">@</span>PennHousing
            </span>
          </div>

          {phase === 'checking' && (
            <p className="t-helper" role="status">
              Verifying your link…
            </p>
          )}

          {phase === 'no-session' && (
            <div className="login-heading">
              <h2>This link isn&apos;t valid</h2>
              <p data-testid="update-password-invalid">
                Your set-password link may have expired or already been used. Request a new one from
                the sign-in page.
              </p>
              <a
                href="/auth/forgot"
                className="t-helper login-forgot"
                data-testid="update-request-new"
              >
                Request a new link
              </a>
            </div>
          )}

          {phase === 'done' && (
            <div className="login-heading">
              <h2>Password set</h2>
              <p data-testid="update-password-done">Your password is set. You can now sign in.</p>
              <a href="/login" className="t-helper login-forgot" data-testid="update-to-login">
                Go to sign in
              </a>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <div className="login-heading">
                <h2>Choose a password</h2>
                <p>Set a password for your Shift account, then sign in.</p>
              </div>
              <form onSubmit={handleSubmit} className="col gap-6">
                <Field label="New password">
                  <TextInput
                    data-testid="update-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="Confirm password">
                  <TextInput
                    data-testid="update-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </Field>
                {error !== null && (
                  <p
                    data-testid="update-password-error"
                    role="alert"
                    className="t-helper"
                    style={{ color: 'var(--st-danger)' }}
                  >
                    {error}
                  </p>
                )}
                <Button
                  data-testid="update-password-submit"
                  type="submit"
                  disabled={submitting}
                  iconRight="arrowRight"
                  full
                >
                  {submitting ? 'Saving…' : 'Set password'}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
