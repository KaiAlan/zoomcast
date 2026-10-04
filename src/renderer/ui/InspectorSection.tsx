import { createContext, useContext, type ReactNode } from "react";

export const InspectorTab = createContext<string | null>(null);

/** Native disclosure keeps controls mounted and never changes project history. */
export function InspectorSection({ title, hint, children, defaultOpen = false }: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const active = useContext(InspectorTab);
  return <details className="inspector-section" hidden={active !== null && active !== title} open={defaultOpen || active === title}>
    <summary><span>{title}</span>{hint && <span className="section-hint">{hint}</span>}</summary>
    <div className="section-content">{children}</div>
  </details>;
}
