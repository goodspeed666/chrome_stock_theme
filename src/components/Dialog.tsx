import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icons';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  description?: string;
  className?: string;
  closeLabel?: string;
}

export function Dialog({ title, description, onClose, children, className = '', closeLabel = '關閉視窗' }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-${crypto.randomUUID()}`).current;
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.querySelector<HTMLElement>('input, select, button, [tabindex="0"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')];
      if (!focusables.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusables[0]!;
      const last = focusables.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, []);

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button subtle" aria-label={closeLabel} onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </section>
  </div>;
}
