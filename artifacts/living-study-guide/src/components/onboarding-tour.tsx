import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUpdateOnboardingProgress } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useLocation } from 'wouter';
import sidebarMiky from '@assets/miky-sidebar_1793431828258.png';

type TourStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

type OnboardingTourProps = {
  open: boolean;
  step: number;
  onClose: () => void;
  onFinish: () => void;
  onStepChange: (step: number) => void;
  onProgressSaved: () => void;
};

const steps = [
  {
    title: 'Meet Miky',
    body: 'This is your private learning workspace. Use the Workspace, Review Hub, and Verified Library navigation to move from your own notes to knowledge worth keeping.',
    target: '[data-tour="workspace-welcome"]',
    path: '/',
    action: 'Let’s Start',
  },
  {
    title: 'Add study material',
    body: 'Paste notes, or upload a PDF, .txt, or .md file. The existing action makes a study pack when you are ready. For this tour, leave everything untouched.',
    target: '[data-tour="study-material"]',
    path: '/',
    action: 'Next',
  },
  {
    title: 'Let Miky prepare a pack',
    body: 'Miky turns your notes into source-linked questions for the review queue. Nothing is generated during this tour.',
    target: '[data-tour="make-pack"]',
    path: '/',
    action: 'Next',
  },
  {
    title: 'Review Hub',
    body: 'Each question stays beside the excerpt it came from. You can edit, discard, or approve a real card when you are ready; we will not change one now.',
    target: '[data-tour="review-hub"]',
    path: '/review',
    action: 'Next',
  },
  {
    title: 'Verify Knowledge',
    body: 'Approving a question adds it to your Verified Library. Approval is always yours to make, and this tour leaves every card as it is.',
    target: '[data-tour="review-actions"]',
    path: '/review',
    action: 'Next',
  },
  {
    title: 'Your learning journey starts here!',
    body: 'The Library holds the questions you have chosen to keep, connected to the notes they came from.',
    target: '[data-tour="verified-library"]',
    path: '/library',
    action: 'Start Learning',
  },
];

export function OnboardingTour({
  open,
  step,
  onClose,
  onFinish,
  onStepChange,
  onProgressSaved,
}: OnboardingTourProps) {
  const [location, setLocation] = useLocation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [saveError, setSaveError] = useState('');
  const updateProgress = useUpdateOnboardingProgress();
  const index = Math.min(5, Math.max(0, step - 1));
  const current = steps[index];
  const targetSelector = current.target;
  const stepPath = current.path;
  const currentAction = current.action;
  const stepNumber = index + 1;
  const placement = useMemo(() => {
    if (!rect) return { top: 110, left: 24 };
    const cardWidth = Math.min(390, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 16));
    const top = rect.bottom + 18 + 270 < window.innerHeight ? rect.bottom + 18 : Math.max(16, rect.top - 290);
    return { top, left };
  }, [rect]);

  const save = useCallback(async (status: TourStatus, nextStep: number) => {
    setSaveError('');
    try {
      await updateProgress.mutateAsync({ data: { status, step: nextStep } });
      onProgressSaved();
      return true;
    } catch {
      setSaveError('Your tour progress could not be saved. Please try again.');
      return false;
    }
  }, [onProgressSaved, updateProgress.mutateAsync]);

  useEffect(() => {
    if (!open) return;
    const background = Array.from(document.querySelectorAll<HTMLElement>('.app-shell > .sidebar, .app-shell > .main-area'));
    const priorInert = background.map((element) => element.hasAttribute('inert'));
    background.forEach((element) => element.setAttribute('inert', ''));
    return () => {
      background.forEach((element, index) => {
        if (!priorInert[index]) element.removeAttribute('inert');
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (location !== stepPath) {
      setLocation(stepPath);
      return;
    }
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) {
      setRect(null);
      return;
    }
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    const updateRect = () => {
      const bounds = target.getBoundingClientRect();
      setRect(new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height));
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [location, open, setLocation, stepPath, targetSelector]);

  const move = useCallback(async (next: number) => {
    if (next > 6) {
      if (await save('completed', 6)) onFinish();
      return;
    }
    if (next < 1) return;
    const nextStep = steps[next - 1];
    if (!(await save('in_progress', next))) return;
    onStepChange(next);
    if (location !== nextStep.path) setLocation(nextStep.path);
  }, [location, onFinish, onStepChange, save, setLocation]);

  const skip = useCallback(async () => {
    if (await save('skipped', stepNumber)) onFinish();
  }, [onFinish, save, stepNumber]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void move(stepNumber + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void move(stepNumber - 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, onClose, open, stepNumber]);

  if (!open) return null;

  return (
    <div className="tour-layer" data-testid="onboarding-tour">
      <div
        className="tour-spotlight"
        aria-hidden="true"
        style={rect ? {
          top: Math.max(0, rect.top - 7),
          left: Math.max(0, rect.left - 7),
          width: Math.min(window.innerWidth, rect.width + 14),
          height: Math.min(window.innerHeight, rect.height + 14),
        } : undefined}
      />
      <section
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        data-testid={`tour-step-${stepNumber}`}
        style={{ top: placement.top, left: placement.left }}
      >
        <div className="tour-guide">
          <img
            src={sidebarMiky}
            alt="Miky, your learning guide"
            data-testid="img-tour-miky"
          />
          <span className="tour-step-label">
            A quick orientation · {String(stepNumber).padStart(2, '0')} / 06
          </span>
        </div>
        <div className="tour-card-top">
          <button className="tour-close" type="button" aria-label="Close tour" onClick={onClose} data-testid="button-tour-close">
            <X size={17} />
          </button>
        </div>
        <div className="tour-progress" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepNumber}>
          <span style={{ width: `${(stepNumber / 6) * 100}%` }} />
        </div>
        <h2 id="tour-title">{current.title}</h2>
        <p id="tour-description">{current.body}</p>
        {saveError && <p className="tour-error" role="alert" data-testid="text-tour-error">{saveError}</p>}
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={() => void skip()} disabled={updateProgress.isPending} data-testid="button-tour-skip">Skip Tour</button>
          <div className="tour-step-actions">
            {stepNumber > 1 && <button type="button" className="btn btn-outline btn-small" onClick={() => void move(stepNumber - 1)} disabled={updateProgress.isPending} data-testid="button-tour-back"><ArrowLeft size={14} /> Back</button>}
            <button type="button" className="btn btn-primary btn-small" onClick={() => void move(stepNumber + 1)} disabled={updateProgress.isPending} data-testid="button-tour-next">
              {updateProgress.isPending ? 'Saving…' : currentAction}
              {stepNumber < 6 && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
