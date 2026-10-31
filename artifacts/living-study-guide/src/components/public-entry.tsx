import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateGuestSession, getGetAuthSessionQueryKey } from '@workspace/api-client-react';
import { ArrowRight, BookOpenCheck, LoaderCircle } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import welcomeMiky from '@assets/Cheerful_Firefly_Reading_a_Book_1793447095602.png';

export function PublicEntry() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createGuest = useCreateGuestSession();
  const [error, setError] = useState('');

  const beginGuestSession = async () => {
    if (createGuest.isPending) return;
    setError('');
    try {
      await createGuest.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
      setLocation('/');
    } catch {
      setError('A guest workspace could not be started. Please try again.');
    }
  };

  return (
    <main className="public-entry">
      <header className="public-header">
        <Link href="/" className="public-brand" data-testid="link-public-brand">
          <span className="brand-mark"><BookOpenCheck size={19} strokeWidth={1.8} /></span>
          <span><strong>Study with Miky</strong><small>Make knowledge stay.</small></span>
        </Link>
        <Link href="/sign-in" className="public-signin" data-testid="link-public-sign-in">Sign in</Link>
      </header>
      <section className="public-hero" aria-labelledby="public-title">
        <div className="public-copy">
          <div className="eyebrow">A PRIVATE PLACE TO LEARN</div>
          <h1 id="public-title">Make knowledge<br /><em>stay.</em></h1>
          <p>Turn your own class notes into questions you can trust. Review each source, keep what you approve, and build a library that feels like yours.</p>
          <div className="public-actions">
            <Link href="/sign-in" className="btn btn-primary public-google" data-testid="button-continue-google">
              Continue with Google <ArrowRight size={16} />
            </Link>
            <button type="button" className="btn btn-outline public-guest" onClick={() => void beginGuestSession()} disabled={createGuest.isPending} data-testid="button-continue-guest">
              {createGuest.isPending ? <><LoaderCircle size={15} className="animate-spin" /> Starting a private space…</> : 'Continue as Guest'}
            </button>
          </div>
          {error && <p className="public-error" role="alert" data-testid="text-guest-error">{error}</p>}
          <p className="guest-caveat" data-testid="text-guest-caveat">Guest data may be temporary and may not be recoverable if this browser session is lost. Create an account to keep it across devices.</p>
          <p className="legacy-note" data-testid="text-legacy-note">Older shared-workspace notes remain unassigned and are not exposed to this account.</p>
        </div>
        <div className="public-artwork">
          <div className="public-art-ring" aria-hidden="true" />
          <img src={welcomeMiky} alt="Miky reading a book" data-testid="img-public-miky" />
          <span className="art-caption">Your notes. Your pace. Your knowledge to keep.</span>
        </div>
      </section>
      <footer className="public-footer">
        <span>Study with Miky</span>
        <span className="public-footer-line" aria-hidden="true" />
        <span>A thoughtful way back to what you’ve learned</span>
      </footer>
    </main>
  );
}
