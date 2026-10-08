import type { SVGProps } from 'react';

const paths = {
  settings: [
    'M4 6h3', 'M11 6h9',
    'M4 12h7', 'M15 12h5',
    'M4 18h4', 'M12 18h8',
    'M11 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    'M15 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    'M12 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: [
    'M20 12a8 8 0 1 1-2.34-5.66',
    'M17.66 6.34 14.8 7.8',
    'M17.66 6.34 17 9.6',
  ],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  edit: ['M12 20h9', 'm16.5 3.5 4 4', 'M4 20l4-.9L19.5 7.6a2.1 2.1 0 0 0-3-3L5 16.1 4 20Z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
  photo: ['M3 3h18v18H3z', 'M8.5 8.5h.01', 'm21 15-5-5-7 7'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  check: ['m5 12 4 4L19 6'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  chart: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  mountain: ['M2.5 20.5 8.4 5.8l3.9 8.2 3.6-4.2 5.6 10.7H2.5Z'],
  candles: [
    'M6 3v5', 'M4 8h4v4H4z', 'M6 12v9',
    'M12 7v3', 'M10 10h4v6h-4z', 'M12 16v5',
    'M18 3v4', 'M16 7h4v6h-4z', 'M18 13v8',
  ],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  clock: ['M12 8v4l2.5 1.5', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
} as const;

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {paths[name].map((d, index) => <path key={`${name}-${index}`} d={d} />)}
  </svg>;
}
