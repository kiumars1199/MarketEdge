// One icon set (docs/19 P7 pattern 7): 24-unit grid, 2 px round stroke, currentColor, 16 px inline / 20 px in nav.
// In-repo on purpose: no icon dependency, each icon is a few hundred bytes. Decorative by default (aria-hidden);
// the control around an icon carries the label.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const ArrowRight = (p: P) => <Icon {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>;
export const ExternalLink = (p: P) => <Icon {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Icon>;
export const ChevronRight = (p: P) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const Search = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const Close = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const Inbox = (p: P) => <Icon {...p}><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></Icon>;
export const Filter = (p: P) => <Icon {...p}><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /></Icon>;
export const Clock = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
