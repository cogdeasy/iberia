type LogoProps = {
  height?: number
}

/** Iberia corporate logo (wordmark + isotype). */
export default function Logo({ height = 30 }: LogoProps) {
  return (
    <img src="/iberia-logo.png" alt="Iberia" height={height} style={{ height, width: 'auto', display: 'block' }} />
  )
}
