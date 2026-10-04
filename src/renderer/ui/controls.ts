/**
 * Shared inspector control styling.
 *
 * These live in their own module rather than in Inspector.tsx because two
 * panels now use them, and a sibling importing from its parent invites the
 * drift this exists to prevent — the cursor section shipped once with larger,
 * brighter labels than the zoom fields directly above it, purely because the
 * styles were written out twice.
 *
 * Standing design law: no bold. Labels and headers are regular weight,
 * separated by size and opacity instead.
 */
export const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "9px 12px",
  background: "var(--control)",
  borderRadius: 10,
  marginBottom: 7,
  minHeight: 40,
};

export const fieldLabel: React.CSSProperties = { fontSize: 13, color: "var(--muted)" };

export const sectionHeader: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.55,
  marginBottom: 8,
};

export const numberInput: React.CSSProperties = {
  width: 92,
  background: "transparent",
  color: "var(--text)",
  border: "1px solid transparent",
  borderRadius: 7,
  padding: "4px 6px",
  fontVariantNumeric: "tabular-nums",
};

/** Same visual weight as numberInput, but wide enough for its longest option. */
export const selectInput: React.CSSProperties = {
  width: 132,
  minWidth: 0,
  maxWidth: "100%",
  padding: "8px 30px 8px 10px",
  fontSize: 12,
  minHeight: 34,
};

export const textInput: React.CSSProperties = {
  ...numberInput,
  fontVariantNumeric: "normal",
};

export const buttonInput: React.CSSProperties = {
  background: "var(--button)",
  color: "var(--text)",
  border: "1px solid transparent",
  borderRadius: 7,
  padding: "4px 10px",
  fontSize: 13,
  cursor: "pointer",
};
