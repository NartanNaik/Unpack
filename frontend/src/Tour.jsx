import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CSS = `
.utour-shield { position: fixed; inset: 0; z-index: 20000; background: transparent; }
.utour-shield.dim { background: rgba(8, 4, 20, 0.7); }

.utour-spot {
  position: fixed;
  z-index: 20001;
  border-radius: 14px;
  pointer-events: none;
  box-shadow: 0 0 0 9999px rgba(8, 4, 20, 0.7), 0 0 0 3px #f6e3a1, 0 0 24px 4px rgba(246, 227, 161, 0.45);
}
.utour-spot::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 18px;
  border: 2px solid rgba(246, 227, 161, 0.75);
  animation: utourPulse 1.4s ease-out infinite;
}
@keyframes utourPulse {
  0% { opacity: 0.9; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.08); }
}

.utour-bubble {
  position: fixed;
  z-index: 20002;
  box-sizing: border-box;
  padding: 18px 20px 16px;
  color: #ffffff;
  background: #4c1d95;
  border: 2px solid #f6e3a1;
  border-radius: 16px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
  font-family: inherit;
  animation: utourIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes utourIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}

/* The sharp speech-bubble tail that points at the feature */
.utour-tail { position: absolute; width: 0; height: 0; }
.utour-tail::before, .utour-tail::after {
  content: "";
  position: absolute;
  width: 0;
  height: 0;
  border-style: solid;
}
.utour-tail.below { top: -2px; animation: utourNudgeUp 1.1s ease-in-out infinite; }
.utour-tail.below::before { left: -13px; top: -15px; border-width: 0 13px 15px 13px; border-color: transparent transparent #f6e3a1 transparent; }
.utour-tail.below::after  { left: -11px; top: -11px; border-width: 0 11px 14px 11px; border-color: transparent transparent #4c1d95 transparent; }

.utour-tail.above { bottom: -2px; animation: utourNudgeDown 1.1s ease-in-out infinite; }
.utour-tail.above::before { left: -13px; top: 0;    border-width: 15px 13px 0 13px; border-color: #f6e3a1 transparent transparent transparent; }
.utour-tail.above::after  { left: -11px; top: -3px; border-width: 14px 11px 0 11px; border-color: #4c1d95 transparent transparent transparent; }

@keyframes utourNudgeUp { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes utourNudgeDown { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }

.utour-badge {
  display: inline-block;
  margin-bottom: 8px;
  padding: 3px 9px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #2a1458;
  background: linear-gradient(135deg, #f6e3a1, #d4a937);
}
.utour-count { margin-bottom: 4px; font-size: 11px; letter-spacing: 0.4px; opacity: 0.7; }
.utour-title { margin: 0 0 8px; font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-weight: 700; color: #f6e3a1; }
.utour-text { margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.92); }
.utour-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.utour-actions { display: flex; gap: 8px; }
.utour-skip { background: transparent; border: none; cursor: pointer; font-size: 13px; color: rgba(255, 255, 255, 0.7); padding: 8px 4px; }
.utour-skip:hover { color: #ffffff; }
.utour-back, .utour-next { padding: 8px 16px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; }
.utour-back { color: #ffffff; background: rgba(255, 255, 255, 0.16); }
.utour-back:hover { background: rgba(255, 255, 255, 0.26); }
.utour-next { color: #2a1458; background: linear-gradient(135deg, #f6e3a1, #d4a937); }
.utour-next:hover { filter: brightness(1.06); }
`;

function layoutFor(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(320, vw - 24);

  if (!rect) {
    return { style: { width, left: (vw - width) / 2, top: Math.max(90, vh / 2 - 120) }, placement: 'center', tailX: 0 };
  }

  const centerX = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(centerX - width / 2, vw - width - 12));
  const tailX = Math.max(30, Math.min(centerX - left, width - 30));

  const spaceBelow = vh - (rect.top + rect.height);
  const below = spaceBelow >= 250 || rect.top < 250;

  const style = below
    ? { width, left, top: rect.top + rect.height + 30 }
    : { width, left, bottom: vh - rect.top + 30 };
  return { style, placement: below ? 'below' : 'above', tailX };
}

export default function Tour({ steps, onClose, onStepChange }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [, setSize] = useState(0);

  const step = steps[index];
  const last = index >= steps.length - 1;

  // Tell the parent which step is showing (it may need to switch tabs)
  useEffect(() => {
    if (step && onStepChange) onStepChange(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  // Follow the target element every frame, so the bubble stays attached while the page scrolls
  useEffect(() => {
    if (!step) return undefined;
    let raf;
    let scrolled = false;
    let lastKey = '';

    const tick = () => {
      const el = step.ref?.current;
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        const key = `${Math.round(r.top)}|${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}`;
        if (key !== lastKey) {
          lastKey = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      } else if (lastKey !== 'none') {
        lastKey = 'none';
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => setSize((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  // Keyboard support
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') (last ? onClose() : setIndex((i) => i + 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose]);

  if (!step) return null;
  const layout = layoutFor(rect);

  return createPortal(
    <>
      <style>{CSS}</style>
      <div className={`utour-shield ${rect ? '' : 'dim'}`} />
      {rect && (
        <div
          className="utour-spot"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div key={step.id} className="utour-bubble" style={layout.style} role="dialog" aria-live="polite">
        {layout.placement !== 'center' && (
          <span className={`utour-tail ${layout.placement}`} style={{ left: layout.tailX }} />
        )}
        {step.isNew && <span className="utour-badge">New</span>}
        <div className="utour-count">Step {index + 1} of {steps.length}</div>
        <div className="utour-title">{step.title}</div>
        <p className="utour-text">{step.text}</p>
        <div className="utour-controls">
          <button className="utour-skip" onClick={onClose}>Skip</button>
          <div className="utour-actions">
            {index > 0 && <button className="utour-back" onClick={() => setIndex((i) => i - 1)}>Back</button>}
            <button className="utour-next" onClick={() => (last ? onClose() : setIndex((i) => i + 1))}>
              {last ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}