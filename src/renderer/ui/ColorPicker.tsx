import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { bounded, colorRgb, hsvRgb, pickerHex, rgbHex, rgbHsv, type Hsv } from "../../shared/style/colorPicker";
import { Icon } from "./Icon";
import "./colorPicker.css";

const RECENTS = "zoomcast.color-recents";
function readRecent(): string[] {
  try {
    const colors: unknown = JSON.parse(localStorage.getItem(RECENTS) ?? "[]");
    return Array.isArray(colors) ? [...new Set(colors.filter((c): c is string => typeof c === "string" && /^#[\da-f]{6}$/i.test(c)).map(c => c.toLowerCase()))].slice(0, 8) : [];
  } catch { return []; }
}
type EyeDropperConstructor = new () => { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };

function ColorNumber({ label, value, max, onChange, onCommit }: { label: string; value: number; max: number; onChange: (n: number) => void; onCommit: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState(shown);
  const edited = useRef(false);
  useEffect(() => { if (document.activeElement !== input.current) setDraft(shown); }, [shown]);
  const finish = () => {
    const n = draft.trim() ? Number(draft) : NaN;
    if (edited.current && Number.isFinite(n)) onChange(bounded(n, max));
    setDraft(Number.isFinite(n) ? String(Math.round(bounded(n, max))) : shown);
    onCommit();
    edited.current = false;
  };
  return <label className="color-number"><input ref={input} type="number" aria-label={`Color ${label}`} min={0} max={max} step={1} value={draft}
    onChange={e => { edited.current = true; setDraft(e.target.value); const n = e.target.valueAsNumber; if (Number.isFinite(n) && n >= 0 && n <= max) onChange(n); }}
    onBlur={finish} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); finish(); input.current?.select(); } }} /><span>{label}</span></label>;
}

/** A lightweight solid-color picker. Backgrounds are opaque, so no inactive opacity controls. */
export function ColorPicker({ value, onChange, onCommit }: { value: string; onChange: (hex: string) => void; onCommit: () => void }) {
  const hex = rgbHex(colorRgb(value));
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => rgbHsv(colorRgb(value)));
  const hsvRef = useRef(hsv);
  const emitted = useRef(hex);
  const callbacks = useRef({ onChange, onCommit }); callbacks.current = { onChange, onCommit };
  const [format, setFormat] = useState<"HEX" | "RGB" | "HSB">("HEX");
  const [draft, setDraft] = useState(hex.slice(1).toUpperCase());
  const [invalid, setInvalid] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hexInput = useRef<HTMLInputElement>(null);
  const drag = useRef<number | null>(null);
  const eye = useRef<AbortController | null>(null);
  const dialogId = useId(), helpId = useId();
  const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;

  useEffect(() => {
    if (hex !== emitted.current) {
      const next = rgbHsv(colorRgb(hex), hsvRef.current);
      hsvRef.current = next; setHsv(next); emitted.current = hex;
    }
    if (document.activeElement !== hexInput.current) { setDraft(hex.slice(1).toUpperCase()); setInvalid(false); }
  }, [hex]);
  useEffect(() => () => { eye.current?.abort(); callbacks.current.onCommit(); }, []);

  const remember = () => {
    const next = [emitted.current, ...readRecent().filter(c => c !== emitted.current)].slice(0, 8);
    try { localStorage.setItem(RECENTS, JSON.stringify(next)); } catch { /* The picker still works without local storage. */ }
    setRecent(next);
    callbacks.current.onCommit();
  };
  const close = useCallback((restoreFocus = false) => {
    eye.current?.abort(); drag.current = null;
    callbacks.current.onCommit(); setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(), box = panel.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const left = anchor.right + 12 + box.width <= innerWidth - 12 ? anchor.right + 12 : anchor.left - box.width - 12;
      setPosition({ left: Math.max(12, Math.min(left, innerWidth - box.width - 12)), top: Math.max(12, Math.min(anchor.top, innerHeight - box.height - 12)) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    const outside = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Node && !panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) close();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !eye.current) { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    document.addEventListener("pointerdown", outside); window.addEventListener("keydown", key, true);
    panel.current?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", key, true); };
  }, [open, close]);

  const apply = (next: Hsv) => {
    hsvRef.current = next; setHsv(next);
    const color = rgbHex(hsvRgb(next));
    emitted.current = color; callbacks.current.onChange(color);
  };
  const choose = (color: string) => { apply(rgbHsv(colorRgb(color), hsvRef.current)); remember(); setDraft(color.slice(1).toUpperCase()); };
  const finishHex = () => {
    const color = pickerHex(draft);
    if (!color) { setInvalid(true); return; }
    choose(color); setInvalid(false);
  };
  const point = (e: PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    apply({ ...hsvRef.current, s: bounded((e.clientX - rect.left) / rect.width * 100, 100), v: bounded((1 - (e.clientY - rect.top) / rect.height) * 100, 100) });
  };
  const keyColor = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); return; }
    const step = e.shiftKey ? 10 : 1;
    const change = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!change) return;
    e.preventDefault(); e.stopPropagation();
    apply({ ...hsvRef.current, s: bounded(hsvRef.current.s + (change[0] ?? 0), 100), v: bounded(hsvRef.current.v + (change[1] ?? 0), 100) });
  };
  const pick = async () => {
    if (!EyeDropper) return;
    const controller = new AbortController(); eye.current = controller;
    setPicking(true); setMessage("");
    try { const result = await new EyeDropper().open({ signal: controller.signal }); if (!controller.signal.aborted) choose(result.sRGBHex); }
    catch (error) { if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setMessage("Could not sample a color. Please try again."); }
    finally { if (eye.current === controller) { eye.current = null; setPicking(false); } }
  };
  const rgb = colorRgb(hex);
  return <>
    <button ref={trigger} type="button" className="color-trigger" aria-label="Custom background color" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} onClick={() => { if (open) close(); else { setRecent(readRecent()); setMessage(""); setOpen(true); } }}>
      <span className="color-chip" style={{ background: hex }} /><span>{hex.slice(1).toUpperCase()}</span><span className="color-trigger-arrow" aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={panel} id={dialogId} role="dialog" aria-label="Background color picker" tabIndex={-1} className="color-picker" style={position}>
      <header><span>Custom color</span><button type="button" className="color-picker-close" aria-label="Close color picker" onClick={() => close(true)}><Icon name="close" size={16} /></button></header>
      <div className="color-picker-body">
        <button type="button" className="color-plane" aria-label={`Color saturation and brightness: ${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`} aria-describedby={helpId} style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = e.pointerId; point(e); }}
          onPointerMove={e => { if (drag.current === e.pointerId) point(e); }}
          onPointerUp={e => { if (drag.current === e.pointerId) { point(e); drag.current = null; remember(); } }}
          onPointerCancel={() => { drag.current = null; remember(); }}
          onKeyDown={keyColor} onKeyUp={e => { if (e.key.startsWith("Arrow")) remember(); }}>
          <span className="color-plane-handle" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }} />
        </button>
        <p id={helpId} className="sr-only">Left and right adjust saturation. Up and down adjust brightness. Hold Shift for larger steps.</p>
        <div className="color-hue-row"><button type="button" className="color-eyedropper" aria-label="Pick color from screen" title={EyeDropper ? "Pick color from screen" : "Screen sampling is unavailable"} disabled={!EyeDropper || picking} onClick={() => void pick()}><Icon name="eyedropper" size={18} /></button>
          <input className="color-hue" type="range" aria-label="Color hue slider" min={0} max={360} step={1} value={hsv.h} onChange={e => apply({ ...hsvRef.current, h: Number(e.target.value) })} onPointerUp={remember} onPointerCancel={remember} onKeyUp={remember} onBlur={remember} />
        </div>
        <div className="color-fields"><select aria-label="Color format" value={format} onChange={e => { callbacks.current.onCommit(); setFormat(e.target.value as typeof format); }}><option>HEX</option><option>RGB</option><option>HSB</option></select>
          {format === "HEX" ? <div className="color-hex"><span aria-hidden="true">#</span><input ref={hexInput} aria-label="Color HEX" aria-invalid={invalid} spellCheck={false} maxLength={7} value={draft}
            onFocus={e => e.target.select()} onChange={e => { const text = e.target.value; setDraft(text); setInvalid(false); if (/^#?[\da-f]{6}$/i.test(text.trim())) { const color = pickerHex(text); if (color) apply(rgbHsv(colorRgb(color), hsvRef.current)); } }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); finishHex(); } }}
            onBlur={() => { const color = pickerHex(draft); if (color) choose(color); else { setDraft(hex.slice(1).toUpperCase()); setInvalid(false); callbacks.current.onCommit(); } }} /></div>
            : format === "RGB" ? (["red", "green", "blue"] as const).map((label, i) => <ColorNumber key={label} label={label} value={rgb[i] ?? 0} max={255} onChange={n => { const channels = colorRgb(emitted.current); channels[i] = n; apply(rgbHsv(channels, hsvRef.current)); }} onCommit={remember} />)
              : (["h", "s", "v"] as const).map((channel, i) => <ColorNumber key={channel} label={["hue", "saturation", "brightness"][i] ?? channel} value={hsv[channel]} max={channel === "h" ? 360 : 100} onChange={n => apply({ ...hsvRef.current, [channel]: n })} onCommit={remember} />)}
        </div>
        {invalid && <p className="color-picker-message" role="status">Enter a 3 or 6 digit HEX color.</p>}
        {(picking || message) && <p className="color-picker-message" role="status">{picking ? "Click a color on your screen. Esc cancels." : message}</p>}
      </div>
      <footer><span>Recent colors</span><div className="color-recents">{recent.length ? recent.map(color => <button type="button" key={color} aria-label={`Use ${color.toUpperCase()}`} title={color.toUpperCase()} style={{ background: color }} onClick={() => choose(color)} />) : <p>Colors you choose appear here.</p>}</div></footer>
    </div>, document.body)}
  </>;
}
