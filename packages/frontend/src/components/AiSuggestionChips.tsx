import React from 'react';

export interface SuggestionAction {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

interface Props {
  suggestions: SuggestionAction[];
  onAction: (suggestion: SuggestionAction) => void;
  loading?: boolean;
}

/**
 * Suggestion chips shown below AI responses.
 * Clicking one sends a quick action to the AI.
 */
const AiSuggestionChips: React.FC<Props> = ({ suggestions, onAction, loading }) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {suggestions.map((s, i) => (
        <button
          key={`${s.action}-${i}`}
          type="button"
          onClick={() => onAction(s)}
          disabled={loading}
          className="px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all 
            bg-surface-muted/50 border-line/60 text-ink-muted 
            hover:bg-surface-elevated hover:border-brand/40 hover:text-brand 
            disabled:opacity-40 disabled:cursor-not-allowed
            active:scale-95 whitespace-nowrap"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
};

export default AiSuggestionChips;
