// Shared inline-SVG icon set (Lucide-style geometry, zero runtime deps).
//
// Why this file exists: the UI/UX guideline we adopted bans emoji-as-icons
// ("use SVG: Heroicons/Lucide"). The landing page and several dashboards
// previously rendered 🆘/🚨/⛽… directly, which renders inconsistently across
// platforms, ignores `currentColor`, breaks dark surfaces, and fails the
// "no emoji icons" check. These components are stroke-based, inherit color
// via `currentColor`, scale with the box, and match the icon language already
// used in AppShell.tsx.
//
// Usage:  <Icon.Fuel className="h-6 w-6 text-brand-600" />
import { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

// Common stroke styling. `vectorEffect` keeps strokes crisp when scaled.
function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-full w-full"
      {...props}
    >
      {children}
    </svg>
  );
}

// ── Safety / alerts ───────────────────────────────────────────
export function ShieldAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Svg>
  );
}
export function Siren(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 18v-5a5 5 0 0 1 10 0v5" />
      <path d="M5 21h14" />
      <path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4" />
      <rect x="6" y="18" width="12" height="3" rx="1" />
    </Svg>
  );
}
export function AlertTriangle(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}
export function LifeBuoy(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M4.9 4.9 9 9M15 15l4.1 4.1M15 9l4.1-4.1M9 15l-4.1 4.1" />
    </Svg>
  );
}

// ── Fuel / energy ─────────────────────────────────────────────
export function Fuel(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17" />
      <path d="M3 13h10" />
      <path d="M13 8h3a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9.5L18 6" />
    </Svg>
  );
}
export function Droplet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-10.5-6-10.5Z" />
    </Svg>
  );
}
export function Gauge(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="m13 13-3 2.5" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" />
    </Svg>
  );
}
export function Battery(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="8" width="16" height="8" rx="2" />
      <path d="M20 11v2" />
      <path d="M5 11v2M8 11v2" />
    </Svg>
  );
}

// ── Time / maintenance ────────────────────────────────────────
export function Clock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}
export function Wrench(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-2.4 2.6-2.6Z" />
    </Svg>
  );
}
export function CalendarCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="m9 15 2 2 4-4" />
    </Svg>
  );
}

// ── People / scoring ──────────────────────────────────────────
export function Award(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.2 13.5 7 22l5-3 5 3-1.2-8.5" />
    </Svg>
  );
}
export function Users(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17.5" cy="9" r="2.8" />
      <path d="M15.5 20a5 5 0 0 1 6.5-4.7" />
    </Svg>
  );
}
export function Driver(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="m9 5 3-2 3 2" />
    </Svg>
  );
}

// ── Ops / layout ──────────────────────────────────────────────
export function Kanban(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="5" height="14" rx="1.5" />
      <rect x="9.5" y="3" width="5" height="9" rx="1.5" />
      <rect x="16" y="3" width="5" height="18" rx="1.5" />
    </Svg>
  );
}
export function Moon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
    </Svg>
  );
}
export function Power(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v9" />
      <path d="M6.5 7a8 8 0 1 0 11 0" />
    </Svg>
  );
}
export function KeyRound(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="5" />
      <path d="m11.5 11.5 8 8M16 16l2-2M19 13l1.5 1.5" />
    </Svg>
  );
}

// ── Media / geo ───────────────────────────────────────────────
export function Video(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </Svg>
  );
}
export function Camera(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8h3l1.5-2h9L18 8h3v11H3z" />
      <circle cx="12" cy="13" r="3.2" />
    </Svg>
  );
}
export function MapPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.6" />
    </Svg>
  );
}
export function Route(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3" />
    </Svg>
  );
}
export function Cpu(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </Svg>
  );
}

// ── Vehicles ──────────────────────────────────────────────────
export function Truck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 17h11V7H2z" />
      <path d="M13 11h5l3 3v3h-8" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </Svg>
  );
}
export function Box(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </Svg>
  );
}
export function Bus(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M3 11h18" />
      <path d="M7 17v2M17 17v2" />
      <circle cx="7.5" cy="14" r="0.6" fill="currentColor" />
      <circle cx="16.5" cy="14" r="0.6" fill="currentColor" />
    </Svg>
  );
}
export function Car(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 13l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5" />
      <path d="M3 13h18v4H3z" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </Svg>
  );
}

// ── Analytics / system ────────────────────────────────────────
export function BarChart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 14v4M12 9v9M17 5v13" />
    </Svg>
  );
}
export function ShieldCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}
export function Activity(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </Svg>
  );
}
export function Signal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12.5a10 10 0 0 1 14 0" />
      <path d="M8 15.5a6 6 0 0 1 8 0" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function Coins(p: IconProps) {
  return (
    <Svg {...p}>
      <ellipse cx="9" cy="7" rx="6" ry="3" />
      <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
      <path d="M3 12v5c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5" />
      <path d="M15 9.5c2.9.3 5 1.5 5 3 0 1.7-2.7 3-6 3" />
    </Svg>
  );
}
export function Layers(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 13l9 5 9-5M3 18l9 5 9-5" />
    </Svg>
  );
}

// ── Contact / nav ─────────────────────────────────────────────
export function Phone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    </Svg>
  );
}
export function Mail(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Svg>
  );
}
export function Globe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3C9.5 5.5 9.5 18.5 12 21" />
    </Svg>
  );
}
export function Check(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12 5 5 9-11" />
    </Svg>
  );
}
export function ArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}
export function Smartphone(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </Svg>
  );
}
export function MapTrace(p: IconProps) {
  // map + dashed trace, used for the lightweight summary nav entry
  return (
    <Svg {...p}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" strokeDasharray="2 2" />
    </Svg>
  );
}
