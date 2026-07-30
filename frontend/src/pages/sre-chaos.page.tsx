import { useCallback, useEffect, useState } from 'react'
import type { PageMeta } from '../lib/pages'
import {
  armChaos,
  CHAOS_MODES,
  CHAOS_TARGETS,
  LOAD_SCENARIOS,
  MODE_UNITS,
  listChaos,
  secondsUntil,
  startLoad,
  stopChaos,
  type ChaosMode,
  type ChaosToggle,
  type LoadScenario,
} from '../lib/sre'

export const meta: PageMeta = {
  path: '/ops/chaos',
  title: 'Chaos & load',
  section: 'ops',
  order: 12,
  roles: ['ops', 'sre', 'admin'],
}

export default function SreChaosPage() {
  const [toggles, setToggles] = useState<ChaosToggle[]>([])
  const [target, setTarget] = useState(CHAOS_TARGETS[1])
  const [mode, setMode] = useState<ChaosMode>('latency')
  const [magnitude, setMagnitude] = useState(700)
  const [ttl, setTtl] = useState(300)
  const [scenario, setScenario] = useState<LoadScenario>('checkout_rush')
  const [duration, setDuration] = useState(60)
  const [rps, setRps] = useState(10)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    listChaos()
      .then(setToggles)
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      setTick((value) => value + 1)
      refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const arm = () => {
    setError(null)
    armChaos({ target, mode, magnitude, ttl_seconds: ttl })
      .then((toggle) => {
        setNotice(`${toggle.mode} injection armed on ${toggle.target} for ${ttl}s`)
        refresh()
      })
      .catch((err: Error) => setError(err.message))
  }

  const stop = (name: string) => {
    setError(null)
    stopChaos(name)
      .then(() => {
        setNotice(`fault injection cleared on ${name}`)
        refresh()
      })
      .catch((err: Error) => setError(err.message))
  }

  const fireLoad = () => {
    setError(null)
    startLoad({ scenario, duration_seconds: duration, rps })
      .then((response) =>
        setNotice(
          `${response.scenario} load started: ${response.requests_planned} requests over ${response.duration_seconds}s`,
        ),
      )
      .catch((err: Error) => setError(err.message))
  }

  return (
    <>
      <section className="hero">
        <h1>Chaos & load control</h1>
        <p>
          Arm a fault on a dependency, watch the SLO burn, then stop it. Toggles expire on their
          own so a demo can never leave the platform degraded.
        </p>
      </section>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Fault injection</h3>
          <div className="field">
            <label htmlFor="chaos-target">Target</label>
            <select
              id="chaos-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {CHAOS_TARGETS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="chaos-mode">Mode</label>
            <select
              id="chaos-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as ChaosMode)}
            >
              {CHAOS_MODES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="chaos-magnitude">Magnitude ({MODE_UNITS[mode]})</label>
            <input
              id="chaos-magnitude"
              type="number"
              min={0}
              value={magnitude}
              onChange={(event) => setMagnitude(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="chaos-ttl">Auto-expiry (seconds)</label>
            <input
              id="chaos-ttl"
              type="number"
              min={1}
              max={3600}
              value={ttl}
              onChange={(event) => setTtl(Number(event.target.value))}
            />
          </div>
          <button className="btn" onClick={arm}>
            Arm injection
          </button>
        </div>

        <div className="card">
          <h3>Synthetic traffic</h3>
          <div className="field">
            <label htmlFor="load-scenario">Scenario</label>
            <select
              id="load-scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as LoadScenario)}
            >
              {LOAD_SCENARIOS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="load-duration">Duration (seconds)</label>
            <input
              id="load-duration"
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="load-rps">Requests per second</label>
            <input
              id="load-rps"
              type="number"
              min={1}
              max={200}
              value={rps}
              onChange={(event) => setRps(Number(event.target.value))}
            />
          </div>
          <button className="btn gold" onClick={fireLoad}>
            Start load generator
          </button>
          <p className="muted">
            Traffic is driven against this deployment's own endpoints, so the reliability console
            fills with real Prometheus data.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>Active toggles</h3>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Mode</th>
              <th>Magnitude</th>
              <th>Expires in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {toggles.map((toggle) => (
              <tr key={`${toggle.target}-${tick}`}>
                <td>
                  <strong>{toggle.target}</strong>
                </td>
                <td>
                  <span className="badge crit">{toggle.mode}</span>
                </td>
                <td>
                  {toggle.magnitude} {MODE_UNITS[toggle.mode]}
                </td>
                <td>{secondsUntil(toggle.expires_at)}s</td>
                <td>
                  <button className="btn ghost" onClick={() => stop(toggle.target)}>
                    Stop
                  </button>
                </td>
              </tr>
            ))}
            {!toggles.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No faults armed — the platform is running clean.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
