type LogoProps = {
  height?: number
  variant?: 'light' | 'dark'
}

/** Iberia wordmark plus the two-ribbon isotype, redrawn as inline vector art. */
export default function Logo({ height = 30, variant = 'light' }: LogoProps) {
  const word = variant === 'light' ? '#ffffff' : 'var(--ib-red)'
  const ribbon = variant === 'light' ? '#ffffff' : 'var(--ib-red)'
  return (
    <svg
      height={height}
      viewBox="0 0 300 100"
      width={height * 3}
      role="img"
      aria-label="Iberia"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="70"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="66"
        letterSpacing="-1"
        fill={word}
      >
        IBERIA
      </text>
      <g transform="translate(200 8) scale(0.27) translate(-180 -110)">
        <path d="M322,252 C388,226 450,166 530,123 L492,196 C440,222 386,241 322,252 Z" fill={ribbon} />
        <path d="M185,395 C285,348 392,272 503,202 L482,252 C452,312 336,374 185,395 Z" fill="#f5a800" />
      </g>
    </svg>
  )
}
