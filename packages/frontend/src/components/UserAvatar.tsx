import React, { useEffect, useState } from 'react';
import { resolveAvatarUrl } from '../utils/avatarUrl';

interface UserAvatarProps {
  avatarUrl?: string | null;
  fullName?: string | null;
  className?: string;
  /** Bust browser cache after re-uploading the same file path. */
  cacheKey?: number;
}

const DEFAULT_UPLOAD_AVATAR_REVISION = '20260621';

export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatarUrl,
  fullName,
  className = 'w-9 h-9 rounded-full',
  cacheKey,
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl, cacheKey]);

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
      <img
        src={src}
        alt={fullName ? `${fullName}'s profile` : 'Profile'}
        className={`object-cover ring-2 ring-slate-700 ${className}`}
        onError={() => setFailed(true)}
      />
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
