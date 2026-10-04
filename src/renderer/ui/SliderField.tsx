import { useId } from "react";
/** The slider and precise numeric field share a single project value. */
export function SliderField({ label, value, min = 0, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min?: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  const id = useId();
  const fill = Math.max(0, Math.min(100, (value - min) / Math.max(0.0001, max - min) * 100));
  return <div className="slider-field">
    <div className="slider-fill" style={{ width: `${fill}%` }} />
    <label htmlFor={id}>{label}</label>
    <input id={id} className="slider-range" aria-label={`${label} slider`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <input className="slider-value" aria-label={label} type="number" min={min} max={max} step={step} value={value} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); }} />
    {unit && <span className="slider-unit">{unit}</span>}
  </div>;
}
