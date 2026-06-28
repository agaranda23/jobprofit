/**
 * ErrorBoundary — pure-logic tests.
 *
 * No DOM, no React, no @testing-library — matches project convention for
 * lightweight boundary tests.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * The React class component API surface that can be tested without mounting:
 *   1. getDerivedStateFromError — sets hasError + captures error.
 *   2. State transition: initial state has hasError: false.
 *   3. getDerivedStateFromError with a null-message error falls back gracefully.
 *   4. The component's children-passthrough path (hasError === false) is the
 *      happy path; confirmed by the static method returning the correct flag.
 *
 * DOM rendering tests (mounting, clicking Reload, expanding <details>) are
 * covered by AppErrorBoundary.test.jsx which uses @testing-library/react.
 */

import { describe, it, expect } from 'vitest';
import ErrorBoundary from '../ErrorBoundary.jsx';

// ---------------------------------------------------------------------------
// 1. getDerivedStateFromError sets hasError and stores the error object
// ---------------------------------------------------------------------------

describe('ErrorBoundary.getDerivedStateFromError', () => {
  it('returns hasError: true and the error object', () => {
    const error = new Error('boom');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  it('captures the error message', () => {
    const error = new Error('render crashed');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.error.message).toBe('render crashed');
  });

  it('handles an error with no message gracefully (message is empty string)', () => {
    const error = new Error();
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    // error.message is '' — fallback in JSX is 'Unknown error'; we just confirm
    // the error object is stored so the render path can apply the fallback.
    expect(state.error).toBe(error);
  });

  it('handles a thrown string (non-Error) without crashing', () => {
    // Some libraries throw strings rather than Error instances.
    // getDerivedStateFromError still receives it as its argument.
    const thrown = 'string error';
    const state = ErrorBoundary.getDerivedStateFromError(thrown);
    expect(state.hasError).toBe(true);
    // error?.message is undefined for a string; JSX fallback shows 'Unknown error'
    expect(state.error?.message).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Initial state is safe (no error, renders children)
// ---------------------------------------------------------------------------

describe('ErrorBoundary initial state', () => {
  it('starts with hasError: false', () => {
    // Instantiate via the class directly (no DOM needed).
    const instance = new ErrorBoundary({ children: null });
    expect(instance.state.hasError).toBe(false);
    expect(instance.state.error).toBeNull();
    expect(instance.state.errorInfo).toBeNull();
  });
});
