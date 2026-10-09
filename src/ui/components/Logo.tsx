let seq = 0;

/** The Kinora mark: a play button with a spark (motion + magic). */
export function Logo({ size = 32 }: { size?: number }) {
  const id = `klogo${++seq}`;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6D5BFF" />
          <stop offset="0.55" stop-color="#B84DF1" />
          <stop offset="1" stop-color="#FF6A88" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id})`} />
      <path d="M190 168Q190 140 214 154L362 242Q386 256 362 270L214 358Q190 372 190 344Z" fill="#fff" />
      <path d="M392 82Q398 114 430 120Q398 126 392 158Q386 126 354 120Q386 114 392 82Z" fill="#fff" />
    </svg>
  );
}
