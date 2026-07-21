import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 12_000;
const FREEFORM_TIMEOUT_MS = 120_000;

type TerminalCommandKey =
  | 'status'
  | 'test'
  | 'logs'
  | 'verify'
  | 'readiness'
  | 'secrets'
  | 'diagnose-ai'
  | 'traffic'
  | 'restart-api'
  | 'ready-app-only'
  | 'migrate-status'
  | 'migrate-deploy'
  | 'unlock-users'
  | 'pm2-save'
  | 'git-status'
  | 'git-pull'
  | 'deploy';

interface TerminalCommandDefinition {
  key: TerminalCommandKey;
  label: string;
  command: string;
  args: string[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface TerminalCommandResult {
  key: TerminalCommandKey | 'freeform';
  label: string;
  commandPreview: string;
  output: string;
}

function getSamsRoot(): string {
  return process.env.SAMS_ROOT?.trim() || process.cwd();
}

function normalizeCommand(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function truncateOutput(output: string): string {
  const clean = output.trim();
  if (clean.length <= MAX_OUTPUT_CHARS) return clean || '(no output)';
  return `${clean.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
}

function shellEscapePreview(value: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

const COMMANDS: Record<TerminalCommandKey, TerminalCommandDefinition> = {
  status: {
    key: 'status',
    label: 'PM2 status',
    command: 'pm2',
    args: ['status'],
    timeoutMs: 20_000,
  },
  test: {
    key: 'test',
    label: 'SAMS production smoke test',
    command: 'bash',
    args: ['scripts/super-admin-test.sh'],
    timeoutMs: 240_000,
  },
  logs: {
    key: 'logs',
    label: 'SAMS API logs',
    command: 'pm2',
    args: ['logs', 'sams-api', '--lines', '120', '--nostream'],
    timeoutMs: 30_000,
  },
  verify: {
    key: 'verify',
    label: 'Post-deploy verification',
    command: 'bash',
    args: ['scripts/post-deploy-verify.sh'],
    timeoutMs: 120_000,
  },
  readiness: {
    key: 'readiness',
    label: 'Production readiness check',
    command: 'bash',
    args: ['scripts/production-readiness-check.sh'],
    timeoutMs: 120_000,
  },
  secrets: {
    key: 'secrets',
    label: 'Provider secrets check',
    command: 'bash',
    args: ['scripts/verify-secrets.sh'],
    timeoutMs: 120_000,
  },
  'diagnose-ai': {
    key: 'diagnose-ai',
    label: 'AI diagnostics',
    command: 'bash',
    args: ['scripts/diagnose-ai.sh'],
    timeoutMs: 120_000,
  },
  traffic: {
    key: 'traffic',
    label: 'Traffic readiness check',
    command: 'bash',
    args: ['scripts/traffic-readiness-check.sh'],
    timeoutMs: 180_000,
    env: { REQUESTS: '800', CONCURRENCY: '40' },
  },
  'restart-api': {
    key: 'restart-api',
    label: 'Restart SAMS API',
    command: 'bash',
    args: ['scripts/restart-api.sh'],
    timeoutMs: 120_000,
  },
  'ready-app-only': {
    key: 'ready-app-only',
    label: 'Switch to app-only production mode',
    command: 'bash',
    args: ['scripts/ready-app-only-production.sh'],
    timeoutMs: 180_000,
  },
  'migrate-status': {
    key: 'migrate-status',
    label: 'Prisma migration status',
    command: 'npx',
    args: ['prisma', 'migrate', 'status', '--schema', 'packages/backend/prisma/schema.prisma'],
    timeoutMs: 120_000,
  },
  'migrate-deploy': {
    key: 'migrate-deploy',
    label: 'Deploy pending Prisma migrations',
    command: 'npx',
    args: ['prisma', 'migrate', 'deploy', '--schema', 'packages/backend/prisma/schema.prisma'],
    timeoutMs: 180_000,
  },
  'unlock-users': {
    key: 'unlock-users',
    label: 'Unlock users',
    command: 'bash',
    args: ['scripts/unlock-users.sh'],
    timeoutMs: 180_000,
  },
  'pm2-save': {
    key: 'pm2-save',
    label: 'Save PM2 process list',
    command: 'pm2',
    args: ['save'],
    timeoutMs: 30_000,
  },
  'git-status': {
    key: 'git-status',
    label: 'Git status',
    command: 'git',
    args: ['status', '--short', '--branch'],
    timeoutMs: 30_000,
  },
  'git-pull': {
    key: 'git-pull',
    label: 'Git pull main',
    command: 'git',
    args: ['pull', 'origin', 'main'],
    timeoutMs: 120_000,
  },
  deploy: {
    key: 'deploy',
    label: 'Production deploy',
    command: 'bash',
    args: ['scripts/deploy-production.sh'],
    timeoutMs: 600_000,
  },
};

const ALIASES: Record<string, TerminalCommandKey> = {
  status: 'status',
  'pm2 status': 'status',
  health: 'readiness',
  'system health': 'readiness',
  'app health': 'readiness',
  'check health': 'readiness',
  'check system': 'readiness',
  'check app': 'readiness',
  'system check': 'readiness',
  test: 'test',
  smoke: 'test',
  'smoke test': 'test',
  'production test': 'test',
  logs: 'logs',
  log: 'logs',
  'api logs': 'logs',
  verify: 'verify',
  check: 'verify',
  'post deploy verify': 'verify',
  'post-deploy-verify': 'verify',
  readiness: 'readiness',
  'readiness check': 'readiness',
  'production readiness': 'readiness',
  'production-readiness': 'readiness',
  secrets: 'secrets',
  'verify secrets': 'secrets',
  'verify-secrets': 'secrets',
  diagnose: 'diagnose-ai',
  'diagnose ai': 'diagnose-ai',
  'diagnose-ai': 'diagnose-ai',
  ai: 'diagnose-ai',
  'ai check': 'diagnose-ai',
  'ai status': 'diagnose-ai',
  'check ai': 'diagnose-ai',
  'fix ai': 'diagnose-ai',
  traffic: 'traffic',
  load: 'traffic',
  'load test': 'traffic',
  restart: 'restart-api',
  'restart api': 'restart-api',
  'restart-api': 'restart-api',
  'restart backend': 'restart-api',
  'restart server': 'restart-api',
  'restart system': 'restart-api',
  'app only': 'ready-app-only',
  'app-only': 'ready-app-only',
  'ready app only': 'ready-app-only',
  'ready-app-only': 'ready-app-only',
  'migrate status': 'migrate-status',
  'migration status': 'migrate-status',
  'migrate-status': 'migrate-status',
  'migrate deploy': 'migrate-deploy',
  'migration deploy': 'migrate-deploy',
  'migrate-deploy': 'migrate-deploy',
  'unlock users': 'unlock-users',
  'unlock-users': 'unlock-users',
  unlock: 'unlock-users',
  'pm2 save': 'pm2-save',
  'pm2-save': 'pm2-save',
  'git status': 'git-status',
  'git-status': 'git-status',
  pull: 'git-pull',
  'git pull': 'git-pull',
  'git-pull': 'git-pull',
  'pull latest': 'git-pull',
  'update code': 'git-pull',
  'sync code': 'git-pull',
  deploy: 'deploy',
  'deploy production': 'deploy',
  'deploy-production': 'deploy',
  publish: 'deploy',
  'go live': 'deploy',
  'ship it': 'deploy',
};

function inferCommandKey(normalized: string): TerminalCommandKey | null {
  if (
    /\b(?:rm|del|erase|format|shutdown|reboot|powershell|cmd|bash|sh|cat|type|more|less|nano|vim|vi|node|tsx|python|curl|wget)\b/.test(normalized) ||
    /[;&|`><]/.test(normalized)
  ) {
    return null;
  }

  if (/\b(?:ai|atomesus|openai|provider|model)\b/.test(normalized)) return 'diagnose-ai';
  if (/\b(?:secret|secrets|env|key|keys)\b/.test(normalized)) return 'secrets';
  if (/\b(?:log|logs|error|errors)\b/.test(normalized)) return 'logs';
  if (/\b(?:restart|reload|bounce)\b/.test(normalized)) return 'restart-api';
  if (/\b(?:unlock|unblock)\b.*\busers?\b|\busers?\b.*\b(?:unlock|unblock)\b/.test(normalized)) return 'unlock-users';
  if (/\b(?:migration|migrate|prisma)\b.*\b(?:deploy|apply|run)\b/.test(normalized)) return 'migrate-deploy';
  if (/\b(?:migration|migrate|prisma)\b/.test(normalized)) return 'migrate-status';
  if (/\b(?:git|code)\b.*\b(?:pull|sync|update|latest)\b|\bpull\s+latest\b/.test(normalized)) return 'git-pull';
  if (/\b(?:deploy|publish|release|go\s+live|ship)\b/.test(normalized)) return 'deploy';
  if (/\b(?:traffic|load|stress)\b/.test(normalized)) return 'traffic';
  if (/\b(?:test|smoke)\b/.test(normalized)) return 'test';
  if (/\b(?:verify|post\s+deploy)\b/.test(normalized)) return 'verify';
  if (/\b(?:ready|readiness|health|diagnose|diagnostic|check|status)\b/.test(normalized)) return 'readiness';
  return null;
}

export function listTerminalCommandHelp(): string {
  return [
    'Super Admin terminal commands use @ and must be confirmed before running:',
    '',
    '- @db - live database overview (handled by SAMS, not shell)',
    '- @status - PM2 process status',
    '- @test - post-deploy verification plus traffic smoke test',
    '- @logs - last SAMS API logs',
    '- @verify - post-deploy verification',
    '- @readiness - production readiness checks',
    '- @secrets - masked provider/secrets check',
    '- @diagnose-ai - AI provider diagnostics',
    '- @traffic - light authenticated/readiness traffic check',
    '- @restart-api - restart the SAMS API',
    '- @ready-app-only - disable SMS-dependent features and keep app notifications only',
    '- @migrate-status - Prisma migration status',
    '- @migrate-deploy - apply pending Prisma migrations',
    '- @unlock-users - remove login cooldown/blocked flags',
    '- @pm2-save - save the PM2 process list',
    '- @git-status - git branch and changed files',
    '- @git-pull - pull latest main from GitHub',
    '- @deploy - run production deploy',
    '',
    'With SAMS_AI_SHELL=1 set on the server, Super Admin can also run any',
    'shell command by prefixing it with @ (e.g. @cat packages/backend/.env,',
    '@df -h, @npm run build). Read-only commands run immediately; anything',
    'that changes the system asks for confirmation first. A few catastrophic',
    'commands (disk wipe, rm -rf /, reboot, force-push) stay blocked.',
  ].join('\n');
}

export function resolveTerminalCommand(input: string): TerminalCommandDefinition | null {
  const normalized = normalizeCommand(input);
  const key = ALIASES[normalized] ?? inferCommandKey(normalized);
  return key ? COMMANDS[key] : null;
}

export function isTerminalCommandRequest(input: string): boolean {
  return input.trim().startsWith('@');
}

export async function runSafeTerminalCommand(input: string): Promise<TerminalCommandResult> {
  const definition = resolveTerminalCommand(input);
  if (!definition) {
    throw new Error(`Unknown or blocked terminal command. ${listTerminalCommandHelp()}`);
  }

  const cwd = path.resolve(getSamsRoot());
  let stdout = '';
  let stderr = '';

  try {
    const result = await execFileAsync(definition.command, definition.args, {
      cwd,
      timeout: definition.timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        ...definition.env,
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const execErr = err as Error & { stdout?: string; stderr?: string; code?: number | string };
    const output = truncateOutput(
      [
        execErr.stdout,
        execErr.stderr,
        `Command failed${execErr.code ? ` with exit code ${execErr.code}` : ''}: ${execErr.message}`,
      ].filter(Boolean).join('\n'),
    );
    throw new Error(output);
  }

  const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n'));
  return {
    key: definition.key,
    label: definition.label,
    commandPreview: [definition.command, ...definition.args].map(shellEscapePreview).join(' '),
    output,
  };
}

// ─── Free-form shell (full VPS power, guarded) ──────────────────────────────────
//
// Enabled only when SAMS_AI_SHELL=1 is set on the server, so a compromised
// browser session cannot reach a shell unless someone with SSH turned it on.
// Every command still passes through the AI confirmation gate (Super Admin
// actions always confirm) and is audit-logged by aiService. A small deny-list
// blocks unrecoverable operations that should only ever run from a raw SSH
// session — everything else is allowed.

/** True when free-form shell has been explicitly enabled on this server. */
export function isFreeformShellEnabled(): boolean {
  const flag = (process.env.SAMS_AI_SHELL || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
}

/**
 * Catastrophic, effectively-unrecoverable commands. These stay blocked even for
 * Super Admin via the chat box — run them from a real SSH session if truly needed.
 */
const CATASTROPHIC_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(?:-\w*\s+)*(?:-[rf]\w*\s+)+(?:~|\$HOME|\/root|\/etc|\/var|\/usr|\/bin|\/boot|\/lib|\/sbin|\/opt)(?:\/\S*)?(?:\s|$)|\brm\s+(?:-\w*\s+)*(?:-[rf]\w*\s+)+(?:\/|\/\*)(?:\s|$)/i, reason: 'recursive delete of a root/system/home path' },
  { re: /\bmkfs(?:\.\w+)?\b/i, reason: 'formatting a filesystem' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, reason: 'writing directly to a disk device' },
  { re: /\b(?:shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i, reason: 'powering off or rebooting the server' },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/i, reason: 'fork bomb' },
  { re: />\s*\/dev\/(?:sd|nvme|hd|vd)\w+/i, reason: 'overwriting a raw disk device' },
  { re: /\bchown\s+(?:-R\s+)?[^\s]+\s+\/(?:\s|$)/i, reason: 'recursive ownership change of /' },
  { re: /\bchmod\s+(?:-R\s+)?[0-7]{3,4}\s+\/(?:\s|$)/i, reason: 'recursive permission change of /' },
  { re: /\bgit\s+(?:push\s+)?(?:-\w+\s+)*--force\b|\bgit\s+push\s+.*\s-f\b/i, reason: 'force-push (rewrites shared history)' },
];

/** Returns a block reason if the command is catastrophic, else null. */
export function findCatastrophicBlock(command: string): string | null {
  const c = command.trim();
  for (const { re, reason } of CATASTROPHIC_PATTERNS) {
    if (re.test(c)) return reason;
  }
  return null;
}

/**
 * Best-effort read-only classification. Read-only commands can auto-run without
 * confirmation; everything else is treated as risky and must be confirmed.
 * Default is RISKY — only clearly safe, side-effect-free commands return true.
 */
const READ_ONLY_HEADS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'pwd', 'whoami', 'id', 'date',
  'uptime', 'df', 'du', 'free', 'ps', 'top', 'env', 'printenv', 'hostname',
  'uname', 'stat', 'file', 'wc', 'grep', 'egrep', 'fgrep', 'find', 'which',
  'echo', 'nproc', 'lscpu', 'lsblk', 'netstat', 'ss', 'ip', 'ping', 'nslookup',
  'dig', 'history', 'tree', 'realpath', 'dirname', 'basename', 'readlink',
]);

const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'config', 'rev-parse', 'describe', 'blame', 'shortlog']),
  pm2: new Set(['status', 'list', 'ls', 'describe', 'show', 'info', 'jlist', 'prettylist', 'logs']),
  docker: new Set(['ps', 'images', 'logs', 'inspect', 'stats', 'version', 'info']),
  npm: new Set(['ls', 'list', 'view', 'outdated', 'config', 'root', 'prefix']),
  systemctl: new Set(['status', 'is-active', 'is-enabled', 'list-units', 'list-unit-files', 'show']),
  prisma: new Set(['migrate']), // only "migrate status" — refined below
};

/** True when the command only reads state (safe to auto-run). */
export function isReadOnlyShellCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  // Any shell control that could chain a mutation makes it non-trivially safe.
  if (/[;&|`$><]|\|\||&&/.test(c)) return false;
  if (/\b(?:sudo)\b/.test(c)) return false; // elevate = treat as risky
  const tokens = c.split(/\s+/);
  const head = tokens[0]?.toLowerCase() ?? '';
  if (READ_ONLY_HEADS.has(head)) return true;
  const sub = tokens[1]?.toLowerCase() ?? '';
  if (head === 'prisma' || (head === 'npx' && sub === 'prisma')) {
    // Only "prisma migrate status" is read-only.
    return c.toLowerCase().includes('migrate status');
  }
  const allowed = READ_ONLY_SUBCOMMANDS[head];
  if (allowed && allowed.has(sub)) {
    // git config with a value is a write; treat bare/get forms as read-only.
    if (head === 'git' && sub === 'config' && /\s(?:--\w+\s+)*[\w.]+\s+\S/.test(c) && !/--get/.test(c)) {
      return false;
    }
    return true;
  }
  return false;
}

export interface FreeformRiskAssessment {
  blocked: boolean;
  blockReason?: string;
  readOnly: boolean;
  requiresConfirmation: boolean;
}

/** Classify a free-form command: blocked / read-only (auto) / risky (confirm). */
export function assessFreeformCommand(command: string): FreeformRiskAssessment {
  const blockReason = findCatastrophicBlock(command);
  if (blockReason) {
    return { blocked: true, blockReason, readOnly: false, requiresConfirmation: false };
  }
  const readOnly = isReadOnlyShellCommand(command);
  return { blocked: false, readOnly, requiresConfirmation: !readOnly };
}

/**
 * Run an arbitrary shell command on the VPS. Caller (aiService) is responsible
 * for enforcing Super Admin role, the enable flag, and confirmation of risky
 * commands. This function still hard-blocks catastrophic patterns as a backstop.
 */
export async function runFreeformShellCommand(command: string): Promise<TerminalCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Empty command.');

  if (!isFreeformShellEnabled()) {
    throw new Error('Free-form shell is disabled. Set SAMS_AI_SHELL=1 on the server to enable it.');
  }

  const blockReason = findCatastrophicBlock(trimmed);
  if (blockReason) {
    throw new Error(`Blocked: ${blockReason}. Run it from a real SSH session if you truly need to.`);
  }

  const cwd = path.resolve(getSamsRoot());
  let stdout = '';
  let stderr = '';
  try {
    // Run through bash -lc so pipes, redirects, and env expansion work as the
    // admin expects. bash is the confirmed shell on the VPS.
    const result = await execFileAsync('bash', ['-lc', trimmed], {
      cwd,
      timeout: FREEFORM_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const execErr = err as Error & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
    const parts = [
      execErr.stdout,
      execErr.stderr,
      execErr.killed ? `Command timed out after ${FREEFORM_TIMEOUT_MS / 1000}s.` : '',
      `Command failed${execErr.code ? ` with exit code ${execErr.code}` : ''}: ${execErr.message}`,
    ].filter(Boolean);
    throw new Error(truncateOutput(parts.join('\n')));
  }

  return {
    key: 'freeform',
    label: `$ ${trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed}`,
    commandPreview: trimmed,
    output: truncateOutput([stdout, stderr].filter(Boolean).join('\n')),
  };
}
