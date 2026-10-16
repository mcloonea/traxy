import { supabase } from './supabase.js';

(() => {
  const form = document.getElementById('auth-form');
  if (!form) return;

  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameField = document.getElementById('name-field');
  const nameInput = document.getElementById('name');
  const passwordInput = document.getElementById('password');
  const submit = document.getElementById('auth-submit');
  const toggle = document.getElementById('mode-toggle');
  const switchLine = document.getElementById('auth-switch');
  const message = document.getElementById('auth-message');
  const forgotPassword = document.getElementById('forgot-password');
  let mode = 'signin';

  function setMode(nextMode) {
    mode = nextMode;
    const isSignup = mode === 'signup';
    document.title = `${isSignup ? 'Create account' : 'Sign in'} | Traxy`;
    title.textContent = isSignup ? 'Create your account' : 'Welcome back';
    subtitle.textContent = isSignup ? 'Create an account.' : 'Sign in to your account.';
    nameField.hidden = !isSignup;
    nameInput.required = isSignup;
    passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
    submit.innerHTML = `${isSignup ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
    submit.dataset.mode = isSignup ? 'signup' : 'signin';
    switchLine.firstChild.textContent = isSignup ? 'Already have an account? ' : 'New to Traxy? ';
    toggle.textContent = isSignup ? 'Sign in' : 'Create an account';
    forgotPassword.hidden = isSignup;
    message.textContent = '';
  }

  toggle.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  forgotPassword.addEventListener('click', event => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) {
      message.textContent = 'Enter your email address first.';
      document.getElementById('email').focus();
      return;
    }
    message.textContent = 'Sending password reset email…';
    supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('auth.html', location.href).href
    }).then(({ error }) => {
      message.textContent = error ? error.message : 'Check your email for a password reset link.';
    }).catch(error => {
      message.textContent = error.message || 'Could not request a password reset.';
    });
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
    const email = document.getElementById('email').value.trim();
    const password = passwordInput.value;
    try {
      const result = mode === 'signup'
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { name: nameInput.value.trim() } }
          })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        message.textContent = result.error.message;
        return;
      }
      if (mode === 'signup' && !result.data.session) {
        message.textContent = 'Account created. Check your email to confirm your address.';
        return;
      }
      location.href = 'chat.html';
    } catch (error) {
      message.textContent = error.message || 'Could not connect to Supabase Auth.';
    } finally {
      submit.disabled = false;
    }
  });
})();
