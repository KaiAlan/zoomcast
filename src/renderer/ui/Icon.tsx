import type { CSSProperties } from "react";
const paths = {
  gallery: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  list: "M3 5h2 M9 5h12 M3 12h2 M9 12h12 M3 19h2 M9 19h12",
  archive: "M3 3h18v5H3z M5 8v13h14V8 M9 12h6",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  plus: "M12 4v16 M4 12h16",
  move: "M3 6h7l2 2h9v12H3V6 M9 14h8 M14 11l3 3-3 3",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M14 14l7 7",
  close: "M5 5l14 14 M5 19 19 5",

  appearance: "M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1L12 3z M19 2v4 M17 4h4",
  cursor: "M5 3l14 10-7 1-3 7-4-18z",
  webcam: "M4 6h4l2-2h4l2 2h4v14H4V6z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  audio: "M4 10v4 M8 6v12 M12 3v18 M16 7v10 M20 10v4",
  output: "M4 14v6h16v-6 M12 3v12 M7 8l5-5 5 5",
  zoom: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14 14l7 7 M7 10h6 M10 7v6",
  settings: "M4 7h16 M4 17h16 M9 4v6 M15 14v6",
  folder: "M3 6h7l2 2h9v12H3V6z",
  play: "M8 5l11 7-11 7V5z",
  pause: "M8 5v14 M16 5v14",
  restart: "M5 5v14 M18 5l-10 7 10 7V5z",
  undo: "M9 5L4 10l5 5 M4 10h9a7 7 0 0 1 7 7",
  redo: "M15 5l5 5-5 5 M20 10h-9a7 7 0 0 0-7 7",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8 8l13 13 M8 16L21 3",
  video: "M3 5h13v14H3z M16 9l5-3v12l-5-3",
  save: "M5 3h12l4 4v14H3V3h2z M7 3v6h10V3 M7 21v-8h10v8",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 19, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
