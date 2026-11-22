import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell.jsx';
import Field from '../components/Field.jsx';
import FormError from '../components/FormError.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Signup() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      await signup(form);
      navigate('/', { replace: true });
    } catch (err) {
      if (err.code === 'VALIDATION' && err.details?.length) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create an account"
      intro="An account lets you host meetings and create invite links. Guests can join without one."
      alt={{ text: 'Have an account?', to: '/login', label: 'Log in' }}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormError>{error}</FormError>
        <Field label="Your name" autoComplete="name" required maxLength={50} value={form.displayName} onChange={set('displayName')} error={fieldErrors.displayName} hint="Shown to other people in meetings." />
        <Field label="Email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={set('email')} error={fieldErrors.email && 'Enter a valid email address.'} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
          value={form.password}
          onChange={set('password')}
          error={fieldErrors.password}
          hint="At least 12 characters. Several unrelated words work well."
        />
        <button disabled={busy} className="btn w-full sm:w-auto">{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}