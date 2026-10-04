import { useLayoutEffect, useRef, useState } from "react";

/** One measurement shared by all regions in a lane. */
export function useTrackWidth() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setTrackWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { trackRef, trackWidthPx };
}
