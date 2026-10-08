import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { chooseControlContext, type ControlCandidate, type ControlContext } from "../../shared/zoom/context";
import type { Rect } from "../../shared/zoom/geometry";

// A separate Windows process keeps slow/broken accessibility providers off the
// recording thread. Uses Windows' built-in assemblies; no model or download.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type 'using System; using System.Runtime.InteropServices; public static class ZoomcastDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context); }'
try { [ZoomcastDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $q = ConvertFrom-Json $line
    if ($q.focus) { $element = [System.Windows.Automation.AutomationElement]::FocusedElement }
    else { $element = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($q.x, $q.y)) }
    $candidates = @()
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
      $c = $element.Current
      $r = $c.BoundingRectangle
      $role = $c.ControlType.ProgrammaticName.Replace('ControlType.', '')
      # Legacy Win32/WinForms providers sometimes report everything as Pane.
      # Native class identifiers classify those controls without reading text.
      if ($role -eq 'Pane' -or $role -eq 'Custom') {
        $class = $c.ClassName
        if ($class -match '(?i)(^|[.])(ComboBox[^.]*)([.]|$)') { $role = 'ComboBox' }
        elseif ($class -match '(?i)(^|[.])(Edit|RichEdit[^.]*|Scintilla)([.]|$)') { $role = 'Edit' }
        elseif ($class -match '(?i)(^|[.])(ToolbarWindow32)([.]|$)') { $role = 'ToolBar' }
        elseif ($class -match '(?i)(^|[.])(SysListView32|ListBox)([.]|$)') { $role = 'List' }
        elseif ($class -match '(?i)(^|[.])(SysTreeView32)([.]|$)') { $role = 'Tree' }
      }
      if (-not $r.IsEmpty -and -not $c.IsOffscreen) {
        $candidates += @{ role=$role; rect=@{ x=$r.X; y=$r.Y; w=$r.Width; h=$r.Height } }
      }
      if ($role -eq 'Window') { break }
      $element = $walker.GetParent($element)
    }
    [Console]::Out.WriteLine((@{ id=$q.id; candidates=@($candidates) } | ConvertTo-Json -Depth 5 -Compress))
  } catch { [Console]::Out.WriteLine((@{ id=$q.id; candidates=@() } | ConvertTo-Json -Compress)) }
}
`;

type Request = { id: number; x: number; y: number; focus: boolean; capture: Rect; resolve: (context: ControlContext | null) => void };
export class SemanticTargetReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private stopped = false;
  private sequence = 0;
  private queue: Request[] = [];
  private active: Request | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  static start(): SemanticTargetReader | null {
    if (process.platform !== "win32") return null;
    const reader = new SemanticTargetReader();
    reader.launch();
    return reader;
  }

  private launch(): void {
    try {
      this.child = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")], { windowsHide: true });
      this.child.on("error", () => this.stop());
      this.child.on("exit", () => this.stop());
      this.child.stdin.on("error", () => this.stop());
      this.child.stderr.resume();
      const lines = createInterface({ input: this.child.stdout });
      lines.on("line", line => {
        try {
          const reply = JSON.parse(line) as { ready?: boolean; id?: number; candidates?: ControlCandidate[] };
          if (reply.ready) { this.ready = true; if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null; this.pump(); return; }
          const active = this.active;
          if (!active || reply.id !== active.id) return;
          if (this.watchdog) clearTimeout(this.watchdog);
          this.watchdog = null; this.active = null;
          active.resolve(chooseControlContext(Array.isArray(reply.candidates) ? reply.candidates : [], active.capture,
            active.focus ? undefined : { x: active.x, y: active.y }));
          this.pump();
        } catch { /* Invalid provider output contributes no semantic metadata. */ }
      });
      // Cold assembly loading can take a second. Keep initial clicks queued.
      this.watchdog = setTimeout(() => this.stop(), 4000);
    } catch { this.stop(); }
  }

  query(x: number, y: number, focus: boolean, capture: Rect): Promise<ControlContext | null> {
    if (this.stopped) return Promise.resolve(null);
    return new Promise(resolve => {
      // Bound work during rapid input. Raw click telemetry is never discarded.
      if (this.queue.length >= 12) this.queue.shift()?.resolve(null);
      this.queue.push({ id: ++this.sequence, x, y, focus, capture, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (!this.ready || this.active || this.stopped) return;
    const request = this.queue.shift();
    if (!request) return;
    this.active = request;
    this.child?.stdin.write(`${JSON.stringify({ id: request.id, x: request.x, y: request.y, focus: request.focus })}\n`);
    // A hung provider cannot stall capture, leave an unbounded backlog, or
    // attach bounds from a subsequently changed UI to an earlier interaction.
    this.watchdog = setTimeout(() => this.stop(), 700);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.active?.resolve(null); this.active = null;
    for (const request of this.queue.splice(0)) request.resolve(null);
    this.child?.kill(); this.child = null;
  }
}
