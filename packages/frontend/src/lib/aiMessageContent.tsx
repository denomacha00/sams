import React from 'react';

export type AiMessageSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; label: string; href: string };

const MD_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const BARE_URL_RE = /^(https?:\/\/[^\s<>\])]+)/;

/** Split assistant text into plain text and clickable link segments (markdown links + bare URLs). */
export function parseAiMessageSegments(input: string): AiMessageSegment[] {
  const segments: AiMessageSegment[] = [];
  let i = 0;

  while (i < input.length) {
    const rest = input.slice(i);
    const md = rest.match(MD_LINK_RE);
    if (md) {
      segments.push({ kind: 'link', label: md[1], href: md[2] });
      i += md[0].length;
      continue;
    }

    const bare = rest.match(BARE_URL_RE);
    if (bare) {
      const href = bare[1];
      segments.push({ kind: 'link', label: href, href });
      i += href.length;
      continue;
    }

    const nextMd = rest.search(/\[/);
    const nextUrl = rest.search(/https?:\/\//);
    let end = rest.length;
    if (nextMd >= 0) end = Math.min(end, nextMd);
    if (nextUrl >= 0) end = Math.min(end, nextUrl);

    if (end === 0) {
      segments.push({ kind: 'text', value: rest[0] });
      i += 1;
      continue;
    }

    segments.push({ kind: 'text', value: rest.slice(0, end) });
    i += end;
  }

  return segments;
}

export const AiMessageContent: React.FC<{ content: string; className?: string; isStreaming?: boolean }> = ({
  content,
  className = 'whitespace-pre-wrap leading-relaxed break-words overflow-hidden',
  isStreaming,
}) => {
  const segments = parseAiMessageSegments(content);

  if (content.length === 0 && isStreaming) {
    return (
      <p className={className}>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-typewriter-pulse" />
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-typewriter-pulse" style={{ animationDelay: '0.2s' }} />
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-typewriter-pulse" style={{ animationDelay: '0.4s' }} />
        </span>
      </p>
    );
  }

  return (
    <p className={`${className} ${isStreaming ? 'ai-streaming-cursor' : ''}`}>
      {segments.map((seg, idx) =>
        seg.kind === 'text' ? (
          <React.Fragment key={idx}>{seg.value}</React.Fragment>
        ) : (
          <a
            key={idx}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300 break-all"
          >
            {seg.label}
          </a>
        ),
      )}
    </p>
  );
};
