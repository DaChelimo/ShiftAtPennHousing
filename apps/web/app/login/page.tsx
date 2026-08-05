'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/Field';
import { LogoMark, Wordmark } from '../../components/ui/Logo';
import { domainWarning } from '../../lib/authEmailHint';
import { PASSWORDLESS_AUTH_ENABLED } from '../../lib/env';
import { createClient } from '../../lib/supabase/client';
import './login.css';

// Cooldown between "Send code" presses, so a worker can't hammer the send-otp
// endpoint. Keep at or above supabase/config.toml's auth.rate_limit.email_sent window
// (per-account, not global) - this is UX pacing, GoTrue enforces the real limit.
const RESEND_COOLDOWN_SECONDS = 30;
const OTP_LENGTH = 6;

function useCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  return { remaining, start: () => setRemaining(seconds) };
}

// Inline, non-blocking domain hint shown under the email field (mirrors the mobile
// app's domainWarning, see lib/authEmailHint.ts). Never prevents submission.
function EmailWarning({ email }: { email: string }) {
  const warning = domainWarning(email);
  if (warning === null) return null;
  return (
    <p data-testid="login-email-warning" className="t-helper login-email-warning">
      {warning}
    </p>
  );
}

// Passwordless flow: request a 6-digit code by email, then type it in here.
// Deliberately code-entry, not a clickable link - a link opened on a worker's phone
// would authenticate the phone's browser, not the shared desk kiosk they're signing
// into. See docs/passwordless-auth plan.
function OtpLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cooldown = useCountdown(RESEND_COOLDOWN_SECONDS);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });

    setSubmitting(false);
    if (otpError !== null) {
      setError(otpError.message);
      return;
    }
    setStep('code');
    cooldown.start();
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });

    if (verifyError !== null) {
      setError(verifyError.message);
      setSubmitting(false);
      return;
    }

    const redirectTo = searchParams.get('redirectTo') ?? '/dashboard';
    router.replace(redirectTo);
    router.refresh();
  }

  if (step === 'email') {
    return (
      <form onSubmit={sendCode} className="login-form col gap-6">
        <div className="login-form-lockup">
          <LogoMark size={32} className="login-mark" />
          <Wordmark className="login-wordmark" />
        </div>

        <div className="login-heading">
          <h2>Sign in</h2>
          <p>Enter your Penn email and we&apos;ll send you a one-time sign-in code.</p>
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
        <EmailWarning email={email} />

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
          data-testid="login-send-code"
          type="submit"
          disabled={submitting || email.trim() === ''}
          iconRight="arrowRight"
          full
        >
          {submitting ? 'Sending…' : 'Send code'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="login-form col gap-6">
      <div className="login-form-lockup">
        <LogoMark size={32} className="login-mark" />
        <Wordmark className="login-wordmark" />
      </div>

      <div className="login-heading">
        <h2>Enter your code</h2>
        <p>
          We sent a {OTP_LENGTH}-digit code to <strong>{email}</strong>.
        </p>
      </div>

      <Field label="Code">
        <TextInput
          data-testid="login-otp-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH}
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </Field>

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
        data-testid="login-verify"
        type="submit"
        disabled={submitting || code.length !== OTP_LENGTH}
        iconRight="arrowRight"
        full
      >
        {submitting ? 'Verifying…' : 'Verify and sign in'}
      </Button>

      <button
        type="button"
        data-testid="login-resend"
        className="t-helper login-forgot"
        disabled={cooldown.remaining > 0}
        onClick={(e) => sendCode(e as unknown as React.FormEvent)}
      >
        {cooldown.remaining > 0 ? `Resend code (${cooldown.remaining}s)` : 'Resend code'}
      </button>

      <button
        type="button"
        data-testid="login-change-email"
        className="t-helper login-forgot"
        onClick={() => {
          setStep('email');
          setCode('');
          setError(null);
        }}
      >
        Use a different email
      </button>
    </form>
  );
}

function PasswordLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

    const redirectTo = searchParams.get('redirectTo') ?? '/dashboard';
    router.replace(redirectTo);
    // Refresh so server components re-read the freshly-set session cookie.
    router.refresh();
  }

  return (
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
      <EmailWarning email={email} />

      <Field label="Password">
        <div className="login-password-wrap">
          <TextInput
            data-testid="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="login-input-pr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="login-password-toggle"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            data-testid="login-password-toggle"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
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
        disabled={submitting || email.trim() === '' || password === ''}
        iconRight="arrowRight"
        full
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
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
            Build schedules, manage floats and swaps, and keep every front desk staffed, all from
            one console.
          </p>
        </div>

        <div className="login-foot">University of Pennsylvania · Residential Services</div>
      </aside>

      <section className="login-form-side">{children}</section>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams must be wrapped in Suspense for static rendering (Next App Router).
  return (
    <Suspense>
      <LoginShell>
        {PASSWORDLESS_AUTH_ENABLED ? <OtpLoginForm /> : <PasswordLoginForm />}
      </LoginShell>
    </Suspense>
  );
}
