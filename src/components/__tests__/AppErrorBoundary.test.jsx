// @vitest-environment jsdom
/**
 * AppErrorBoundary — unit tests
 *
 * Verifies that each variant renders its fallback UI when a child throws.
 * Uses @testing-library/react for minimal DOM assertions — the same harness
 * used by componentSmoke.test.jsx in this project.
 *
 * DrawerErrorBoundary is now a re-export of AppErrorBoundary, so these tests
 * cover both the new boundary and the existing drawer usage.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AppErrorBoundary from '../AppErrorBoundary';
import { logTelemetry } from '../../lib/telemetry';

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
}));

// Suppress the expected React error boundary console.error noise in test output.
// React always logs caught errors even when they are handled by a boundary.
let consoleErrorSpy;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logTelemetry.mockClear();
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

// A child component that unconditionally throws on render.
function Bomb({ message = 'Test render error' }) {
  throw new Error(message);
}

// ─── variant="drawer" ────────────────────────────────────────────────────────

describe('AppErrorBoundary variant="drawer"', () => {
  it('renders children when no error occurs', () => {
    render(
      <AppErrorBoundary variant="drawer" onClose={() => {}}>
        <span>Safe content</span>
      </AppErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeTruthy();
  });

  it('renders the drawer fallback when a child throws', () => {
    render(
      <AppErrorBoundary variant="drawer" onClose={() => {}}>
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByText("Couldn’t load job details")).toBeTruthy();
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });

  it('calls onClose when the Close button is tapped', () => {
    const onClose = vi.fn();
    render(
      <AppErrorBoundary variant="drawer" onClose={onClose}>
        <Bomb />
      </AppErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── variant="screen" ────────────────────────────────────────────────────────

describe('AppErrorBoundary variant="screen"', () => {
  it('renders children when no error occurs', () => {
    render(
      <AppErrorBoundary variant="screen">
        <span>Finance data</span>
      </AppErrorBoundary>
    );
    expect(screen.getByText('Finance data')).toBeTruthy();
  });

  it('renders the screen fallback when a child throws', () => {
    render(
      <AppErrorBoundary variant="screen">
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByText(/something went wrong loading your figures/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('resets error state when the Retry button is tapped', () => {
    // Render a boundary that starts errored, then check the retry button
    // resets the boundary (children re-render successfully if they no longer throw).
    let shouldThrow = true;
    function ConditionalBomb() {
      if (shouldThrow) throw new Error('oops');
      return <span>Recovered</span>;
    }

    render(
      <AppErrorBoundary variant="screen">
        <ConditionalBomb />
      </AppErrorBoundary>
    );

    expect(screen.getByText(/something went wrong loading your figures/i)).toBeTruthy();

    // Stop throwing, then press Retry to reset the boundary
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    // After reset the boundary re-renders children — ConditionalBomb now returns normally
    // Note: rerender is not needed because handleReset calls setState internally
    expect(screen.getByText('Recovered')).toBeTruthy();
  });

  // Today and Jobs are wrapped with the same variant="screen" boundary as
  // FinanceScreen (fix/error-boundaries-today-jobs) — one screen's render
  // throw must show its own contained fallback, never a blank app.
  it('renders Today-specific copy when screen="today"', () => {
    render(
      <AppErrorBoundary variant="screen" screen="today">
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByText(/something went wrong loading today's jobs/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('renders Jobs-specific copy when screen="jobs"', () => {
    render(
      <AppErrorBoundary variant="screen" screen="jobs">
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByText(/something went wrong loading your jobs/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('calls logTelemetry once with the screen label when a child throws', () => {
    render(
      <AppErrorBoundary variant="screen" screen="jobs">
        <Bomb message="boom" />
      </AppErrorBoundary>
    );
    expect(logTelemetry).toHaveBeenCalledTimes(1);
    expect(logTelemetry).toHaveBeenCalledWith('error_boundary_crash', {
      variant: 'screen',
      screen: 'jobs',
      message: 'boom',
    });
  });
});

// ─── variant="app" ───────────────────────────────────────────────────────────

describe('AppErrorBoundary variant="app"', () => {
  it('renders children when no error occurs', () => {
    render(
      <AppErrorBoundary variant="app">
        <span>App shell content</span>
      </AppErrorBoundary>
    );
    expect(screen.getByText('App shell content')).toBeTruthy();
  });

  it('renders the app-level fallback when a child throws', () => {
    render(
      <AppErrorBoundary variant="app">
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
  });

  it('shows a role="alert" region in the app fallback', () => {
    render(
      <AppErrorBoundary variant="app">
        <Bomb />
      </AppErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

// ─── DrawerErrorBoundary re-export ───────────────────────────────────────────

describe('DrawerErrorBoundary (re-export of AppErrorBoundary)', () => {
  it('is the same class as AppErrorBoundary', async () => {
    const { default: DrawerErrorBoundary } = await import('../DrawerErrorBoundary');
    expect(DrawerErrorBoundary).toBe(AppErrorBoundary);
  });
});
