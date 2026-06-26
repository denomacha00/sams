import { describe, expect, it } from 'vitest';
import {
  isTerminalCommandRequest,
  listTerminalCommandHelp,
  resolveTerminalCommand,
} from './superAdminTerminalOps';

describe('superAdminTerminalOps', () => {
  it('requires @ prefix for terminal command requests', () => {
    expect(isTerminalCommandRequest('@status')).toBe(true);
    expect(isTerminalCommandRequest('status')).toBe(false);
  });

  it('resolves only allowlisted terminal commands', () => {
    expect(resolveTerminalCommand('@status')?.key).toBe('status');
    expect(resolveTerminalCommand('@pm2 status')?.key).toBe('status');
    expect(resolveTerminalCommand('@test')?.key).toBe('test');
    expect(resolveTerminalCommand('@diagnose ai')?.key).toBe('diagnose-ai');
    expect(resolveTerminalCommand('@readiness')?.key).toBe('readiness');
    expect(resolveTerminalCommand('@verify secrets')?.key).toBe('secrets');
    expect(resolveTerminalCommand('@migrate status')?.key).toBe('migrate-status');
    expect(resolveTerminalCommand('@migrate deploy')?.key).toBe('migrate-deploy');
    expect(resolveTerminalCommand('@unlock users')?.key).toBe('unlock-users');
    expect(resolveTerminalCommand('@app only')?.key).toBe('ready-app-only');
    expect(resolveTerminalCommand('@pm2 save')?.key).toBe('pm2-save');
    expect(resolveTerminalCommand('@git pull')?.key).toBe('git-pull');
    expect(resolveTerminalCommand('@deploy')?.key).toBe('deploy');
  });

  it('blocks arbitrary shell commands', () => {
    expect(resolveTerminalCommand('@rm -rf /')).toBeNull();
    expect(resolveTerminalCommand('@cat secrets/providers.env')).toBeNull();
    expect(resolveTerminalCommand('@bash -c whoami')).toBeNull();
  });

  it('documents the allowed command list', () => {
    const help = listTerminalCommandHelp();
    expect(help).toContain('@status');
    expect(help).toContain('@test');
    expect(help).toContain('@readiness');
    expect(help).toContain('@migrate-deploy');
    expect(help).toContain('@deploy');
  });
});
