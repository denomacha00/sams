import React, { useEffect, useState } from 'react';
import { resolveAvatarUrl } from '../utils/avatarUrl';

interface UserAvatarProps {
  avatarUrl?: string | null;
  fullName?: string | null;
  className?: string;
  previewable?: boolean;
  /** Bust browser cache after re-uploading the same file path. */
  cacheKey?: number;
}

const DEFAULT_UPLOAD_AVATAR_REVISION = '20260621';

export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatarUrl,
  fullName,
  className = 'w-9 h-9 rounded-full',
  previewable = false,
  cacheKey,
}) => {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl, cacheKey]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewOpen]);

  let src = !failed ? resolveAvatarUrl(avatarUrl) : null;
  const versionKey =
    cacheKey ??
    (src?.includes('/uploads/avatars/') ? DEFAULT_UPLOAD_AVATAR_REVISION : undefined);
  if (src && versionKey != null) {
    src = `${src}${src.includes('?') ? '&' : '?'}v=${versionKey}`;
  }
  const initial = fullName?.charAt(0)?.toUpperCase() || 'U';

  if (src) {
    return (
      <>
        <img
          src={src}
          alt={fullName ? `${fullName}'s profile` : 'Profile'}
          className={`object-cover ring-2 ring-slate-700 ${previewable ? 'cursor-zoom-in' : ''} ${className}`}
          onClick={(event) => {
            if (!previewable) return;
            event.preventDefault();
            event.stopPropagation();
            setPreviewOpen(true);
          }}
          onKeyDown={(event) => {
            if (!previewable || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            event.stopPropagation();
            setPreviewOpen(true);
          }}
          tabIndex={previewable ? 0 : undefined}
          role={previewable ? 'button' : undefined}
          title={previewable ? 'View profile photo' : undefined}
          onError={() => setFailed(true)}
        />
        {previewable && previewOpen && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={() => setPreviewOpen(false)}
          >
            <div className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{fullName || 'Profile photo'}</p>
                  <p className="text-xs text-white/60">Profile photo</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
                >
                  Close
                </button>
              </div>
              <img
                src={src}
                alt={fullName ? `${fullName}'s full profile` : 'Full profile'}
                className="max-h-[78vh] w-full rounded-2xl object-contain shadow-2xl"
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`bg-indigo-600 flex items-center justify-center text-white text-sm font-bold ring-2 ring-slate-700 ${className}`}
    >
      {initial}
    </div>
  );
};
