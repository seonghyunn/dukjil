'use client';

import { useState } from 'react';

export function PosterImage({
  src,
  title,
  className = '',
}: {
  src: string;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div
        aria-label={`${title} 이미지 없음`}
        className={`ticket-fallback ${className}`}
      >
        <span>{title.slice(0, 14)}</span>
      </div>
    );
  return (
    <img
      src={src}
      alt={`${title} 공식 이미지`}
      className={className}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  );
}
