import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Copy,
  Factory,
  KeyRound,
  Leaf,
  LogIn,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import {
  logoutUser,
  registerWithEmail,
  requestPasswordReset,
  signInWithEmail,
} from '../services/authService';
import {
  DEMO_CREDENTIALS,
  DEMO_SHARED_PASSWORD,
  provisionAllDemoRoles,
  signInWithDemoRole,
} from '../services/demoSeedService';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types/domain';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Input';

const FIREBASE_AUTH_PROVIDERS_URL =
  'https://console.firebase.google.com/project/arctic-environs-d2bjt/authentication/providers';

export function AuthPage() {
  const { user, refreshContext } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = React.useState<'signin' | 'register' | 'reset'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [busyRole, setBusyRole] = React.useState<Role | 'ALL' | null>(null);
  const [progressText, setProgressText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [providerDisabled, setProviderDisabled] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user && !busyRole) {
      navigate('/overview', { replace: true });
    }
  }, [user, busyRole, navigate]);

  const copyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard failures in restricted frames
    }
  };

  const mapAuthError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/operation-not-allowed') || msg.includes('PASSWORD_LOGIN_DISABLED')) {
      setProviderDisabled(true);
      return 'Email/Password authentication is currently disabled in your Firebase project.';
    }
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
      return 'Invalid email or password. Verify the client credentials or use a demo role credential.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'An account with this email already exists. Please sign in with its password.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters.';
    }
    return msg;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setProviderDisabled(false);
    try {
      if (mode === 'reset') {
        await requestPasswordReset(email);
        setNotice('Password reset link sent. Check your inbox and return to sign in.');
        setMode('signin');
      } else if (mode === 'register') {
        await registerWithEmail(email, password, displayName);
        await refreshContext();
        navigate('/overview');
      } else {
        await signInWithEmail(email, password);
        await refreshContext();
        navigate('/overview');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDemoRoleSignIn = async (role: Role) => {
    setBusyRole(role);
    setError(null);
    setNotice(null);
    setProviderDisabled(false);
    setProgressText('Authenticating...');
    try {
      await signInWithDemoRole(role, (msg) => setProgressText(msg));
      await refreshContext();
      navigate('/overview');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusyRole(null);
      setProgressText(null);
    }
  };

  const handleProvisionAllRoles = async () => {
    setBusyRole('ALL');
    setError(null);
    setNotice(null);
    setProviderDisabled(false);
    setProgressText('Initializing demo workspace and all 9 role accounts...');
    try {
      await provisionAllDemoRoles((msg) => setProgressText(msg));
      await logoutUser();
      setNotice(
        'All 9 role credentials and the Apex Precision Manufacturing demo workspace are ready. Click Sign In on any role.'
      );
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusyRole(null);
      setProgressText(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9fafc] flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        {/* Top Brand Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded bg-[#070e16] text-white flex items-center justify-center font-display text-xs font-bold">
              M
            </div>
            <div>
              <span className="font-display text-sm tracking-tight text-[#070e16] font-semibold block leading-none">
                MUSHAI SYSTEMS
              </span>
              <span className="text-[11px] text-[#555f69]">
                Industrial Operations &amp; EHS Execution Platform
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-[#555f69]">
            <span className="inline-flex items-center gap-1.5">
              <Factory className="h-3.5 w-3.5 text-[#e60018]" />
              Nexus Operations
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Leaf className="h-3.5 w-3.5 text-[#007e46]" />
              Environ EHS
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#070e16]" />
              Core RBAC
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Client Credential Login Card */}
          <div className="lg:col-span-5 bg-white border border-[#d9dfe5] rounded-lg p-6 sm:p-7">
            <div className="mb-5">
              <div className="flex items-center gap-2 text-[#070e16] mb-1">
                <KeyRound className="h-4 w-4" />
                <h1 className="text-lg font-semibold">
                  {mode === 'signin'
                    ? 'Client Credential Sign In'
                    : mode === 'register'
                      ? 'Create Tenant Admin Account'
                      : 'Reset Account Password'}
                </h1>
              </div>
              <p className="text-xs text-[#555f69]">
                {mode === 'signin'
                  ? 'Sign in with the email and password credentials issued by your administrator.'
                  : mode === 'register'
                    ? 'Register an administrator account to provision a new client organisation.'
                    : 'Enter your work email to receive a password reset link.'}
              </p>
            </div>

            {providerDisabled && (
              <div className="mb-4 rounded-md border border-[#fde68a] bg-[#fffbeb] p-3.5 text-xs text-[#92400e] space-y-2">
                <p className="font-semibold text-[#78350f]">
                  Action Required in Firebase Console (One-Time Setup)
                </p>
                <p>
                  Email/Password sign-in is disabled on project <span className="font-mono-tabular font-semibold">arctic-environs-d2bjt</span>. Enable it once so client &amp; demo credentials can authenticate:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[11px]">
                  <li>Open Authentication Sign-in Providers in Firebase Console.</li>
                  <li>Click <strong>Add new provider</strong> &rarr; <strong>Email/Password</strong>.</li>
                  <li>Toggle <strong>Enable</strong> on and click <strong>Save</strong>, then retry Sign In.</li>
                </ol>
                <a
                  href={FIREBASE_AUTH_PROVIDERS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-[#070e16] underline mt-1"
                >
                  Open Firebase Authentication Providers
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {error && !providerDisabled && (
              <div className="mb-4 flex items-start gap-2.5 rounded-md border border-[#fecaca] bg-[#fef2f2] p-3 text-xs text-[#b91c1c]">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="mb-4 rounded-md border border-[#a7f3d0] bg-[#ecfdf5] p-3 text-xs text-[#047857]">
                {notice}
              </div>
            )}

            <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <Label htmlFor="auth_name">Full Name</Label>
                  <Input
                    id="auth_name"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Priya Nair"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="auth_email">Work Email</Label>
                <Input
                  id="auth_email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@company.com"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label htmlFor="auth_password" className="mb-0">
                      Password
                    </Label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setError(null);
                        }}
                        className="text-xs text-[#555f69] hover:text-[#070e16] cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="auth_password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                  />
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={busy || busyRole !== null}
              >
                {busy
                  ? 'Authenticating...'
                  : mode === 'signin'
                    ? 'Sign In'
                    : mode === 'register'
                      ? 'Create Admin Account'
                      : 'Send Reset Link'}
              </Button>
            </form>

            <div className="mt-5 pt-4 border-t border-[#e9eef4] flex items-center justify-between text-xs text-[#555f69]">
              {mode === 'signin' ? (
                <>
                  <span>Provisioning a new tenant?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className="font-semibold text-[#070e16] hover:underline cursor-pointer"
                  >
                    Create admin account
                  </button>
                </>
              ) : (
                <>
                  <span>Have issued credentials?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                    }}
                    className="font-semibold text-[#070e16] hover:underline cursor-pointer"
                  >
                    Back to sign in
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right: Demo Credentials for All 9 Roles */}
          <div className="lg:col-span-7 bg-white border border-[#d9dfe5] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e9eef4] flex flex-wrap items-center justify-between gap-3 bg-[#f9fafc]">
              <div>
                <h2 className="text-sm font-semibold text-[#070e16]">
                  Demo Access — All 9 RBAC Roles
                </h2>
                <p className="text-xs text-[#555f69] mt-0.5">
                  Shared password:{' '}
                  <span className="font-mono-tabular font-semibold text-[#070e16]">
                    {DEMO_SHARED_PASSWORD}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyValue('demo_pw', DEMO_SHARED_PASSWORD)}
                    className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#555f69] hover:text-[#070e16] cursor-pointer"
                    title="Copy shared demo password"
                  >
                    {copiedKey === 'demo_pw' ? (
                      <>
                        <Check className="h-3 w-3 text-[#007e46]" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy
                      </>
                    )}
                  </button>
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={busy || busyRole !== null}
                onClick={() => void handleProvisionAllRoles()}
              >
                {busyRole === 'ALL' ? 'Initializing...' : 'Initialize All 9 Accounts'}
              </Button>
            </div>

            {progressText && (
              <div className="px-6 py-2.5 bg-[#edf2f8] border-b border-[#d9dfe5] text-xs text-[#070e16] font-medium">
                {progressText}
              </div>
            )}

            <div className="divide-y divide-[#e9eef4]">
              {DEMO_CREDENTIALS.map((cred) => {
                const isRowBusy = busyRole === cred.role;
                return (
                  <div
                    key={cred.role}
                    className="px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#f9fafc] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#070e16]">
                          {cred.label}
                        </span>
                        <span className="text-[11px] text-[#555f69]">
                          · {cred.displayName}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#555f69] truncate">
                        {cred.scopeSummary}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEmail(cred.email);
                          setPassword(cred.password);
                          setMode('signin');
                          void copyValue(cred.role, cred.email);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#d9dfe5] bg-white text-[11px] font-mono-tabular text-[#070e16] hover:bg-[#edf2f8] cursor-pointer"
                        title="Fill & copy email"
                      >
                        <span>{cred.email}</span>
                        {copiedKey === cred.role ? (
                          <Check className="h-3 w-3 text-[#007e46]" />
                        ) : (
                          <Copy className="h-3 w-3 text-[#555f69]" />
                        )}
                      </button>

                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || busyRole !== null}
                        onClick={() => void handleDemoRoleSignIn(cred.role)}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        {isRowBusy ? 'Signing In...' : 'Sign In'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
