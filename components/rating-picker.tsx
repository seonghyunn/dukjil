'use client';

import { Star } from 'lucide-react';

export function RatingStars({
  value,
  showValue = true,
}: {
  value: number;
  showValue?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`별점 ${value.toFixed(1)}점`}
    >
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const fill = Math.max(0, Math.min(1, value - (star - 1)));
          return (
            <span key={star} className="relative block size-4">
              <Star className="absolute inset-0 size-4 text-black/15" />
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star className="size-4 fill-[#f3b85b] text-[#f3b85b]" />
              </span>
            </span>
          );
        })}
      </span>
      {showValue && (
        <b className="text-xs tabular-nums text-black/55">{value.toFixed(1)}</b>
      )}
    </span>
  );
}

export function RatingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="rounded-2xl bg-black/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-black/55">별점</span>
        {value == null ? (
          <span className="text-xs text-black/35">미입력</span>
        ) : (
          <span className="flex items-center gap-2">
            <RatingStars value={value} />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] text-black/35 underline"
            >
              지우기
            </button>
          </span>
        )}
      </div>
      <input
        aria-label="별점 선택"
        type="range"
        min="0.5"
        max="5"
        step="0.5"
        value={value ?? 0.5}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-2 w-full cursor-pointer accent-[#ff6b61]"
      />
      <div className="mt-1 flex justify-between text-[10px] text-black/30">
        <span>0.5</span>
        <span>5.0</span>
      </div>
    </div>
  );
}
