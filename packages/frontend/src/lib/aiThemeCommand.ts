import { setSamsTheme, type Theme } from '../hooks/useTheme';

export interface AiThemeCommand {
  theme: Theme;
  label: string;
}

const THEME_COMMAND_RE = /\b(?:change|switch|set|turn|activate|use|make)\b.*\b(light|dark)\b.*\b(?:mode|theme)?\b/i;
const SHORT_THEME_RE = /^(light|dark)\s*(?:mode|theme)?$/i;

export function detectAiThemeRequest(message: string): AiThemeCommand | null {
  const trimmed = message.trim();
  const match = trimmed.match(THEME_COMMAND_RE) ?? trimmed.match(SHORT_THEME_RE);
  const rawTheme = match?.[1]?.toLowerCase();

  if (rawTheme !== 'light' && rawTheme !== 'dark') return null;
  return {
    theme: rawTheme,
    label: rawTheme === 'light' ? 'Light theme' : 'Dark theme',
  };
}

export function applyAiThemeCommand(command: AiThemeCommand): void {
  setSamsTheme(command.theme);
}
