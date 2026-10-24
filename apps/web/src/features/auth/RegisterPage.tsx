import { PASSWORD_MIN_CHARS, RegisterBody } from '@mc/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { TextField } from '../../components/TextField';
import { AuthCard, FormError, SubmitButton } from './AuthCard';
import { useAuth } from './authContext';
import { apiFormErrors, zodFieldErrors, type FieldErrors } from './formErrors';
import { GoogleSignIn } from './GoogleSignIn';
import { redirectTarget } from './redirect';

export function RegisterPage() {
  const { state, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ displayName: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (state.status === 'authenticated')
    return <Navigate to={redirectTarget(location.state)} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = RegisterBody.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      await register(parsed.data);
      navigate(redirectTarget(location.state), { replace: true });
    } catch (err) {
      const { fields, form } = apiFormErrors(err);
      setFieldErrors(fields);
      setFormError(form);
      setPending(false);
    }
  }

  const set = (field: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state} className="text-indigo-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError message={formError} />
        <GoogleSignIn returnTo={redirectTarget(location.state)} />
        <TextField
          label="Display name"
          name="displayName"
          autoComplete="nickname"
          value={values.displayName}
          onChange={set('displayName')}
          error={fieldErrors.displayName}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={fieldErrors.password}
          hint={`At least ${PASSWORD_MIN_CHARS} characters. A short phrase works well.`}
        />
        <SubmitButton pending={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
