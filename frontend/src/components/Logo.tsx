type LogoProps = {
  height?: number
  variant?: 'light' | 'dark'
}

/**
 * Iberia wordmark + ribbon, redrawn as an inline SVG so it scales crisply and needs no asset.
 * `light` is the white-on-red header treatment; `dark` is red-on-white.
 */
export default function Logo({ height = 30, variant = 'light' }: LogoProps) {
  const word = variant === 'light' ? '#ffffff' : 'var(--ib-red)'
  const ribbonTop = variant === 'light' ? '#ffffff' : 'var(--ib-red)'
  return (
    <svg
      height={height}
      viewBox="0 0 250 48"
      width={height * (250 / 48)}
      role="img"
      aria-label="Iberia"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="36"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="40"
        letterSpacing="0.5"
        fill={word}
      >
        IBERIA
      </text>
      <path d="M176 30 C193 17 216 10 246 8 C220 17 199 28 187 40 C182 37 178 34 176 30 Z" fill={ribbonTop} />
      <path d="M183 43 C196 32 216 23 244 18 C221 28 205 38 195 48 C190 47 186 45 183 43 Z" fill="var(--ib-gold)" />
    </svg>
  )
}
