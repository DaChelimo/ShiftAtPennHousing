'use client';

import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Field, TextInput } from '../../../components/ui/Field';
import { Icon } from '../../../components/ui/Icon';
import { createClient } from '../../../lib/supabase/client';
import '../../login/login.css';

// Phase D — request a password reset / first-time set-password email. GoTrue sends a
// recovery link to /auth/update-password. For security we always show the same
// confirmation whether or not the address exists (no account enumeration), and even
// when SMTP is not configured (the admin can still hand out a link via "Resend invite").
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    // Always report success (no enumeration); the recovery email is best-effort.
    setSent(true);
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

          <div className="login-heading">
            <h2>Set or reset your password</h2>
            <p>Enter your Penn email and we&apos;ll send you a link to set a new password.</p>
          </div>

          {sent ? (
            <p className="t-helper" role="status" data-testid="forgot-sent">
              If an account exists for that email, a set-password link is on its way. Check your
              inbox, then follow the link to choose a password. If you don&apos;t receive it, ask
              your manager to resend your invite.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="col gap-6">
              <Field label="Email">
                <TextInput
                  data-testid="forgot-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Button
                data-testid="forgot-submit"
                type="submit"
                disabled={submitting}
                iconRight="arrowRight"
                full
              >
                {submitting ? 'Sending…' : 'Send link'}
              </Button>
            </form>
          )}

          <a href="/login" className="t-helper login-forgot" data-testid="forgot-back">
            Back to sign in
          </a>
        </div>
      </section>
    </main>
  );
}
