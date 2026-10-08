import type { SVGProps } from 'react';

const paths = {
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-1.99 1.72l-.2 1.38a7.9 7.9 0 0 0-1.37.79l-1.26-.5a2 2 0 0 0-2.43.87l-.22.39a2 2 0 0 0 .46 2.53l1.02.9a8 8 0 0 0 0 1.56l-1.02.9a2 2 0 0 0-.46 2.53l.22.39a2 2 0 0 0 2.43.87l1.26-.5c.42.32.88.59 1.37.79l.2 1.38A2 2 0 0 0 11.78 22h.44a2 2 0 0 0 1.99-1.72l.2-1.38c.49-.2.95-.47 1.37-.79l1.26.5a2 2 0 0 0 2.43-.87l.22-.39a2 2 0 0 0-.46-2.53l-1.02-.9a8 8 0 0 0 0-1.56l1.02-.9a2 2 0 0 0 .46-2.53l-.22-.39a2 2 0 0 0-2.43-.87l-1.26.5a7.9 7.9 0 0 0-1.37-.79l-.2-1.38A2 2 0 0 0 12.22 2Z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: [
    'M20 7v5h-5',
    'M4 17v-5h5',
    'M5.6 9A7 7 0 0 1 18 6l2 2',
    'M4 16l2.4 2A7 7 0 0 0 18.4 15',
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
