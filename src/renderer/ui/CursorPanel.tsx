import { defaultProject } from "../../shared/project/defaults";
import type { CursorStyle } from "../../shared/project/types";
import { CURSOR_APPEARANCES, cursorArt, cursorPaint } from "../../shared/cursor/appearance";
import { InspectorSection } from "./InspectorSection";
import { SliderField } from "./SliderField";

export function CursorPanel({ cursor, hasPosition, onChange }: { cursor: CursorStyle; hasPosition: boolean; onChange: (next: CursorStyle) => void }) {
  const set = (over: Partial<CursorStyle>): void => onChange({ ...cursor, ...over });
  return <InspectorSection title="Cursor">
    {!hasPosition && <p className="control-help">This recording has no recorded cursor position. Cursor styles and effects need a recorded cursor.</p>}
    <div className="cursor-panel-header">
      <button type="button" className="inspector-reset" onClick={() => onChange(defaultProject("").style.cursor)}>Reset cursor</button>
      <label>Show Cursor<input type="checkbox" checked={cursor.visible} onChange={e => set({ visible: e.target.checked })} /></label>
      <label>Loop Cursor<input type="checkbox" checked={cursor.loop} onChange={e => set({ loop: e.target.checked })} /></label>
    </div>
    <fieldset className="cursor-style-grid"><legend className="sr-only">Cursor style</legend>
      {CURSOR_APPEARANCES.map(({ id, label }) => {
        const art = cursorArt("arrow", id), paint = cursorPaint(id);
        return <button key={id} type="button" aria-label={`${label} cursor`} title={label} aria-pressed={cursor.appearance === id} onClick={() => set({ appearance: id })}>
          <svg aria-hidden="true" viewBox="-4 -4 40 40"><path d={art.path} fill={paint.fill} stroke={paint.stroke} strokeWidth={paint.width} strokeLinejoin="round" strokeLinecap="round" /></svg>
          <span>{label}</span>
        </button>;
      })}
    </fieldset>
    <SliderField label="Cursor Size" unit="×" min={0.1} max={5} step={0.05} value={cursor.sizePct / 100} onChange={size => set({ sizePct: Math.round(size * 100) })} />
    <SliderField label="Cursor Motion Blur" unit="×" max={1} step={0.05} value={cursor.motionBlur} onChange={motionBlur => set({ motionBlur })} />
    <SliderField label="Cursor Click Bounce" unit="×" max={5} step={0.1} value={cursor.clickBounce} onChange={clickBounce => set({ clickBounce })} />
    <SliderField label="Bounce Speed" unit="ms" min={100} max={1000} step={10} value={cursor.bounceDurationMs} onChange={bounceDurationMs => set({ bounceDurationMs })} />
    <SliderField label="Cursor Sway" unit="×" max={2} step={0.05} value={cursor.sway} onChange={sway => set({ sway })} />
    {(cursor.motionBlur > 0 || cursor.sway > 0 || cursor.clickBounce > 0) && <p className="control-help">Blur and sway show while the cursor moves. Bounce plays on recorded clicks.</p>}
    {cursor.loop && <p className="control-help">Returns the cursor to its starting point at the end of the edited clip for smooth looping playback.</p>}
    <div className="subsection-label">Tracking & clicks</div>
    <SliderField label="Smoothing" max={1} step={0.05} value={cursor.smoothing} onChange={smoothing => set({ smoothing })} />
    <div className="cursor-extra-toggles">
      <label>Shadow<input type="checkbox" checked={cursor.shadow} onChange={e => set({ shadow: e.target.checked })} /></label>
      <label>Click ripples<input type="checkbox" checked={cursor.ripples} onChange={e => set({ ripples: e.target.checked })} /></label>
    </div>
  </InspectorSection>;
}
