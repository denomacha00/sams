import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assessFreeformCommand,
  findCatastrophicBlock,
  isFreeformShellEnabled,
  isReadOnlyShellCommand,
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

  it('infers boss-style @ control commands without requiring exact wording', () => {
    expect(resolveTerminalCommand('@health')?.key).toBe('readiness');
    expect(resolveTerminalCommand('@check ai')?.key).toBe('diagnose-ai');
    expect(resolveTerminalCommand('@restart the backend')?.key).toBe('restart-api');
    expect(resolveTerminalCommand('@pull latest code')?.key).toBe('git-pull');
    expect(resolveTerminalCommand('@ship it')?.key).toBe('deploy');
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
    expect(help).toContain('SAMS_AI_SHELL=1');
  });
});

describe('free-form shell risk assessment', () => {
  const originalFlag = process.env.SAMS_AI_SHELL;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SAMS_AI_SHELL;
    else process.env.SAMS_AI_SHELL = originalFlag;
  });

  describe('enable flag', () => {
    it('is off by default and on only for truthy flag values', () => {
      delete process.env.SAMS_AI_SHELL;
      expect(isFreeformShellEnabled()).toBe(false);
      for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
        process.env.SAMS_AI_SHELL = v;
        expect(isFreeformShellEnabled()).toBe(true);
      }
      for (const v of ['0', 'false', 'no', '']) {
        process.env.SAMS_AI_SHELL = v;
        expect(isFreeformShellEnabled()).toBe(false);
      }
    });
  });

  describe('catastrophic deny-list', () => {
    it('blocks unrecoverable commands', () => {
      expect(findCatastrophicBlock('rm -rf /')).not.toBeNull();
      expect(findCatastrophicBlock('rm -rf /var/www')).not.toBeNull();
      expect(findCatastrophicBlock('sudo rm -fr /etc')).not.toBeNull();
      expect(findCatastrophicBlock('mkfs.ext4 /dev/sda1')).not.toBeNull();
      expect(findCatastrophicBlock('dd if=/dev/zero of=/dev/sda')).not.toBeNull();
      expect(findCatastrophicBlock('shutdown -h now')).not.toBeNull();
      expect(findCatastrophicBlock('reboot')).not.toBeNull();
      expect(findCatastrophicBlock(':(){ :|:& };:')).not.toBeNull();
      expect(findCatastrophicBlock('git push --force origin main')).not.toBeNull();
      expect(findCatastrophicBlock('chmod -R 777 /')).not.toBeNull();
    });

    it('allows normal admin commands through the deny-list', () => {
      expect(findCatastrophicBlock('rm -rf node_modules')).toBeNull();
      expect(findCatastrophicBlock('rm packages/backend/tmp.log')).toBeNull();
      expect(findCatastrophicBlock('cat packages/backend/.env')).toBeNull();
      expect(findCatastrophicBlock('npm run build')).toBeNull();
      expect(findCatastrophicBlock('pm2 restart sams-api')).toBeNull();
      expect(findCatastrophicBlock('git pull origin main')).toBeNull();
    });
  });

  describe('read-only classification', () => {
    it('treats state-reading commands as read-only', () => {
      for (const c of [
        'ls -la', 'cat packages/backend/.env', 'df -h', 'free -m',
        'git status', 'git log --oneline -5', 'pm2 status', 'pm2 logs sams-api',
        'ps aux', 'tail -n 100 /var/log/sams/sams-api-out.log', 'whoami',
        'npx prisma migrate status',
      ]) {
        expect(isReadOnlyShellCommand(c), c).toBe(true);
      }
    });

    it('treats mutating commands as NOT read-only', () => {
      for (const c of [
        'rm tmp.log', 'npm install express', 'npm run build',
        'pm2 restart sams-api', 'git pull origin main', 'git commit -m x',
        'echo secret > packages/backend/.env', 'cat a | tee b',
        'sudo systemctl restart nginx', 'npx prisma migrate deploy',
        'git config user.email me@x.com',
      ]) {
        expect(isReadOnlyShellCommand(c), c).toBe(false);
      }
    });
  });

  describe('combined assessment', () => {
    it('auto-runs read-only, confirms risky, blocks catastrophic', () => {
      const readOnly = assessFreeformCommand('cat packages/backend/.env');
      expect(readOnly).toMatchObject({ blocked: false, readOnly: true, requiresConfirmation: false });

      const risky = assessFreeformCommand('pm2 restart sams-api');
      expect(risky).toMatchObject({ blocked: false, readOnly: false, requiresConfirmation: true });

      const blocked = assessFreeformCommand('rm -rf /');
      expect(blocked.blocked).toBe(true);
      expect(blocked.blockReason).toBeTruthy();
    });
  });
});
