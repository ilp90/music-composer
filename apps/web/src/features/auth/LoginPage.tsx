import { LoginBody } from '@mc/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { TextField } from '../../components/TextField';
import { AuthCard, FormError, SubmitButton } from './AuthCard';
import { useAuth } from './authContext';
import { apiFormErrors, zodFieldErrors, type FieldErrors } from './formErrors';
import { googleErrorMessage } from './googleErrors';
import { GoogleSignIn } from './GoogleSignIn';
import { redirectTarget } from './redirect';

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // A failed Google sign-in lands here with ?error=<reason>.
  const [formError, setFormError] = useState(() => googleErrorMessage(searchParams.get('error')));
  const [pending, setPending] = useState(false);

  if (state.status === 'authenticated')
    return <Navigate to={redirectTarget(location.state)} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = LoginBody.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      await login(parsed.data);
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
      title="Sign in"
      footer={
        <>
          New here?{' '}
          <Link to="/register" state={location.state} className="text-indigo-400 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError message={formError} />
        <GoogleSignIn returnTo={redirectTarget(location.state)} />
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
          autoComplete="current-password"
          value={values.password}
          onChange={set('password')}
          error={fieldErrors.password}
        />
        <SubmitButton pending={pending}>{pending ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
