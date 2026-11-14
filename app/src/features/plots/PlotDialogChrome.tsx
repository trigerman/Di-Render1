import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { dataText as d, type Locale } from '../../i18n/messages';
import './plot-workflow.css';

export type PlotStep = 'source' | 'import' | 'design';
export type PlotNavigation = { onBack: () => void; onReset: () => void };
const steps: { id: PlotStep; label: string }[] = [
  { id: 'source', label: 'chooseData' }, { id: 'import', label: 'reviewData' }, { id: 'design', label: 'designPlot' },
];

export function PlotDialogHeader({ locale, title, onClose, busy, step, canReview, onStep }: {
  locale: Locale; title: string; onClose: () => void; busy?: boolean;
  step?: PlotStep; canReview?: boolean; onStep?: (step: PlotStep) => void;
}) {
  const current = steps.findIndex(item => item.id === step);
  return <>
    <header className="plot-dialog-header">
      <div><span className="plot-eyebrow">Di-Render / {d(locale, 'dataVisualization')}</span><h2 id="plot-dialog-title">{title}</h2></div>
      <button type="button" className="plot-icon-button" aria-label={d(locale, 'close')} title={d(locale, 'close')} disabled={busy} onClick={onClose}><X aria-hidden="true" /></button>
    </header>
    {step && <nav className="plot-steps" aria-label={d(locale, 'plotSteps')}><ol>{steps.map((item, index) => <li key={item.id} data-current={item.id === step} data-complete={index < current}>
      <button type="button" aria-current={item.id === step ? 'step' : undefined} disabled={busy || index >= current || item.id === 'import' && !canReview} onClick={() => onStep?.(item.id)}>
        <span className="plot-step-number" aria-hidden="true">{index < current ? <Check /> : String(index + 1).padStart(2, '0')}</span><span>{d(locale, item.label)}</span>
      </button>
    </li>)}</ol></nav>}
  </>;
}

export function PlotDialogFooter({ locale, onClose, navigation, busy, atStart, primary, hint }: {
  locale: Locale; onClose: () => void; navigation?: PlotNavigation; busy?: boolean; atStart?: boolean;
  primary?: ReactNode; hint?: string;
}) {
  return <footer className="plot-dialog-footer">
    <div className="plot-footer-start">{navigation && <>
      <button type="button" disabled={busy || atStart} onClick={navigation.onBack}><ArrowLeft aria-hidden="true" />{d(locale, 'back')}</button>
      <button type="button" className="plot-reset" disabled={busy} onClick={navigation.onReset} title={d(locale, 'resetHint')}><RotateCcw aria-hidden="true" />{d(locale, 'reset')}</button>
    </>}</div>
    {hint && <span className="plot-footer-hint">{hint}</span>}
    <div className="plot-footer-end"><button type="button" onClick={onClose} disabled={busy}>{d(locale, 'cancel')}</button>{primary}</div>
  </footer>;
}

export function ContinueIcon() { return <ArrowRight aria-hidden="true" />; }
