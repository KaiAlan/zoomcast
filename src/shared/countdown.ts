/** Short sine tones at a low gain, with ramps to avoid clicks or harsh attacks. */
export const COUNTDOWN_CUES = {
  tick: { frequencies: [660], durationMs: 95, gain: 0.045 },
  started: { frequencies: [784, 1047], durationMs: 220, gain: 0.04 },
} as const;

export function countdownOverlayBounds(display: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(300, display.width), height = Math.min(300, display.height);
  return { x: Math.round(display.x + (display.width - width) / 2), y: Math.round(display.y + (display.height - height) / 2), width, height };
}

/** Fixed local content. No preload or app filesystem access is exposed to this window. */
export function countdownCueHtml(): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>zoomcast countdown</title>
  <style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Segoe UI,system-ui,sans-serif;color:#fff}
    body{display:grid;place-items:center}
    .countdown-card{box-sizing:border-box;width:264px;height:264px;display:flex;flex-direction:column;align-items:center;justify-content:center;
      border-radius:50%;background:rgba(18,24,38,.94);border:2px solid rgba(255,255,255,.32)}
    .countdown-label{font-size:13px;color:#cbd5e1;letter-spacing:.5px}
    .countdown-number{font-size:144px;line-height:1.12;font-weight:650;font-variant-numeric:tabular-nums;color:#fff}
    .countdown-help{font-size:12px;color:#cbd5e1}
    .countdown-number.pulse{animation:pulse 260ms ease-out}
    @keyframes pulse{from{transform:scale(.85);opacity:.5}to{transform:scale(1);opacity:1}}
    @media(prefers-reduced-motion:reduce){.countdown-number.pulse{animation:none}}
  </style>
  <body><div class="countdown-card" role="status" aria-live="assertive"><div class="countdown-label">Recording starts in</div>
    <div class="countdown-number"></div><div class="countdown-help">Get ready</div></div>
  <script>
    const cues = ${JSON.stringify(COUNTDOWN_CUES)};
    let context;
    let lastTick;
    let started = false;
    async function tone(kind) {
      try {
        context ??= new AudioContext();
        if (context.state === 'suspended') await context.resume();
        const cue = cues[kind], start = context.currentTime + .005;
        const duration = cue.durationMs / 1000 / cue.frequencies.length;
        cue.frequencies.forEach((frequency, index) => {
          const at = start + duration * index, end = at + duration;
          const oscillator = context.createOscillator(), gain = context.createGain();
          oscillator.type = 'sine'; oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(cue.gain, at + .012);
          gain.gain.setValueAtTime(cue.gain, end - .025);
          gain.gain.linearRampToValueAtTime(0, end);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(at); oscillator.stop(end);
        });
      } catch (error) { console.warn('Recording cue audio unavailable', error); }
    }
    window.countdownCue = {
      async tick(number) {
        if (!Number.isInteger(number) || number < 1 || number > 10 || number === lastTick) return;
        lastTick = number;
        const digit = document.querySelector('.countdown-number');
        digit.textContent = String(number); digit.classList.remove('pulse'); void digit.offsetWidth; digit.classList.add('pulse');
        await tone('tick');
      },
      async started() { if (started) return; started = true; await tone('started'); }
    };
  </script></body></html>`;
}
