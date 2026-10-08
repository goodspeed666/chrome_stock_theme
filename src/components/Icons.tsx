import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  settings: 'M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-6.3 1.1 2.5 2.1.9 2.5-1.1 2 2-1.1 2.5.9 2.1L24 12l-2.5 1.1-.9 2.1 1.1 2.5-2 2-2.5-1.1-2.1.9L12 22l-1.1-2.5-2.1-.9-2.5 1.1-2-2 1.1-2.5-.9-2.1L2 12l2.5-1.1.9-2.1-1.1-2.5 2-2 2.5 1.1 2.1-.9L12 2Z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3',
  close: 'm6 6 12 12M18 6 6 18',
  edit: 'm14 5 5 5M4 20l4-.8L19.5 7.7a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  photo: 'M4 5h16v14H4zM8 10h.01M20 15l-5-5-7 8',
  bell: 'M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  check: 'm5 12 4 4L19 6',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  chart: 'M4 19V5m0 14h16M7 15l4-4 3 2 5-6m-4 0h4v4',
};

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
