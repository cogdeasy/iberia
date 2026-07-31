const FLOW = ['Flight', 'Passengers', 'Payment', 'Confirmation']

/** Booking funnel progress indicator; `current` is the 1-based active step. */
export default function Steps({ current }: { current: number }) {
  return (
    <div className="steps">
      {FLOW.map((label, index) => {
        const position = index + 1
        const state = position === current ? 'is-active' : position < current ? 'is-done' : ''
        return (
          <div key={label} style={{ display: 'contents' }}>
            {index > 0 && <span className="step-sep">———</span>}
            <div className={`step ${state}`}>
              <span className="dot">{position < current ? '✓' : position}</span>
              {label}
            </div>
          </div>
        )
      })}
    </div>
  )
}
