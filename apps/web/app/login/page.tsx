'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/Field';
import { LogoMark, Wordmark } from '../../components/ui/Logo';
import { createClient } from '../../lib/supabase/client';
import './login.css';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError !== null) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    const redirectTo = searchParams.get('redirectTo') ?? '/';
    router.replace(redirectTo);
    // Refresh so server components re-read the freshly-set session cookie.
    router.refresh();
  }

  return (
    <main className="login">
      <aside className="login-brand" aria-hidden="true">
        <div className="login-lockup">
          <LogoMark size={40} variant="reversed" className="login-mark" />
          <Wordmark className="login-wordmark" />
        </div>

        <div className="login-pitch">
          <h1>Residential desk coverage, coordinated.</h1>
          <p>
            Build schedules, manage floats and swaps, and keep every front desk staffed — all from
            one console.
          </p>
        </div>

        <div className="login-foot">University of Pennsylvania · Residential Services</div>
      </aside>

      <section className="login-form-side">
        <form onSubmit={handleSubmit} className="login-form col gap-6">
          <div className="login-form-lockup">
            <LogoMark size={32} className="login-mark" />
            <Wordmark className="login-wordmark" />
          </div>

          <div className="login-heading">
            <h2>Sign in</h2>
            <p>Welcome back. Enter your credentials to access the admin console.</p>
          </div>

          <Field label="Email">
            <TextInput
              data-testid="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password">
            <TextInput
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <a href="/auth/forgot" data-testid="login-forgot" className="t-helper login-forgot">
            Forgot or need to set your password?
          </a>

          {error !== null && (
            <p
              data-testid="login-error"
              role="alert"
              className="t-helper"
              style={{ color: 'var(--st-danger)' }}
            >
              {error}
            </p>
          )}

          <Button
            data-testid="login-submit"
            type="submit"
            disabled={submitting}
            iconRight="arrowRight"
            full
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams must be wrapped in Suspense for static rendering (Next App Router).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
