export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="8" height="8" rx="2" fill="#2dd4bf" />
      <rect x="13" y="3" width="8" height="8" rx="2" fill="#2f3641" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill="#2f3641" />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="#2f3641" />
    </svg>
  )
}
