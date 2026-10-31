import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  useCreateNote,
  useDeleteNote,
  useExtractPdfText,
  useExtractStudyPack,
  useFetchVerifiedGuide,
  useGenerateMoreCards,
  useGetAuthSession,
  useGetStudySummary,
  useHealthCheck,
  useListVerifiedGuides,
  useListNoteCards,
  useListNotes,
  useReviewCard,
  useSearchLibrary,
  useTransferGuestData,
  useUpdateOnboardingProgress,
  getFetchVerifiedGuideQueryKey,
  getGetAuthSessionQueryKey,
  getGetStudySummaryQueryKey,
  getListNoteCardsQueryKey,
  getListNotesQueryKey,
  getListVerifiedGuidesQueryKey,
  getSearchLibraryQueryKey,
} from '@workspace/api-client-react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  FileText,
  Library,
  LoaderCircle,
  NotebookPen,
  Search,
  Sparkles,
  Sun,
  Moon,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import welcomeMiky from '@assets/Cheerful_Firefly_Reading_a_Book_1793447095602.png';
import sidebarMiky from '@assets/miky-sidebar_1793431828258.png';
import { OnboardingTour } from '@/components/onboarding-tour';
import { PublicEntry } from '@/components/public-entry';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } },
});
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#527F60',
    colorForeground: '#202923',
    colorMutedForeground: '#647168',
    colorDanger: '#A6534B',
    colorBackground: '#FBFCF8',
    colorInput: '#F0F3EE',
    colorInputForeground: '#202923',
    colorNeutral: '#E1E7E0',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#FBFCF8] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#202923] font-semibold',
    headerSubtitle: 'text-[#647168]',
    formFieldLabel: 'text-[#34443A]',
    formFieldInput: 'bg-[#F0F3EE] text-[#202923] border-[#D8E1D8]',
    formFieldRow: { display: 'none' },
    formButtonPrimary: { display: 'none' },
    dividerRow: { display: 'none' },
    alternativeMethods: { display: 'none' },
    socialButtonsBlockButton: 'bg-[#F0F3EE] border-[#D8E1D8] text-[#202923]',
    socialButtonsBlockButtonText: { color: '#202923', fontWeight: 600 },
    footerActionLink: 'text-[#527F60]',
    footerActionText: 'text-[#647168]',
    dividerText: 'text-[#647168]',
  },
};

type NoteRecord = { id: string; title: string; rawText: string; createdAt: string };
type CardRecord = {
  id: string;
  noteId: string;
  sourceExcerpt: string;
  concept: string;
  question: string;
  answer: string;
  status: string;
  createdAt: string;
};
type LibraryRecord = {
  id: string;
  cardId: string;
  concept: string;
  question: string;
  answer: string;
  editedByUser: boolean;
  createdAt: string;
};

function formatDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? 'Recently added'
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function getPdfErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('data' in error)) return undefined;
  const data = (error as { data?: unknown }).data;
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error;
  }
  return undefined;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const authSessionQuery = useGetAuthSession({
    query: { queryKey: getGetAuthSessionQueryKey(), staleTime: 0, refetchOnMount: 'always' },
  });
  const session = authSessionQuery.data;
  const summary = useGetStudySummary();
  const health = useHealthCheck();
  const notesQuery = useListNotes();
  const deleteNote = useDeleteNote();
  const transferGuest = useTransferGuestData();
  const updateOnboarding = useUpdateOnboardingProgress();
  const notes = (notesQuery.data ?? []) as NoteRecord[];
  const [notePendingDelete, setNotePendingDelete] = useState<NoteRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDismissed, setTransferDismissed] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(1);
  const autoTourIdentity = useRef('');
  const selectedNote = location.startsWith('/review/') ? decodeURIComponent(location.slice('/review/'.length)) : '';
  const isGuideSelected = location.startsWith('/library/') ? decodeURIComponent(location.slice('/library/'.length)) : '';
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('living-study-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const onboardingStatus = session?.onboarding?.status;
  const onboardingStep = session?.onboarding?.step ?? 1;
  const onboardingIdentity = session?.user?.id ?? session?.kind ?? '';
  useEffect(() => {
    setTransferDismissed(false);
  }, [session?.user?.id]);
  useEffect(() => {
    if (!session || (session.kind !== 'guest' && session.kind !== 'user')) return;
    if (session.kind === 'user' && session.guestAvailable && !transferDismissed) return;
    if (autoTourIdentity.current === onboardingIdentity) return;
    autoTourIdentity.current = onboardingIdentity;
    if (onboardingStatus === 'completed' || onboardingStatus === 'skipped') return;
    setTourStep(onboardingStatus === 'in_progress' ? onboardingStep : 1);
    setTourOpen(true);
  }, [onboardingIdentity, onboardingStatus, onboardingStep, session, transferDismissed]);
  useEffect(() => {
    if (session?.kind === 'user' && session.guestAvailable && !transferDismissed) {
      setTransferOpen(true);
      setTransferError('');
    }
  }, [session?.kind, session?.guestAvailable, transferDismissed]);
  const refreshAuthSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
  }, [queryClient]);
  const replayTour = async () => {
    try {
      await updateOnboarding.mutateAsync({ data: { status: 'not_started', step: 1 } });
      await queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
      setTourStep(1);
      setTourOpen(true);
      setProfileOpen(false);
      setLocation('/');
    } catch {
      setTransferError('The tour could not be restarted just now.');
    }
  };
  const confirmGuestTransfer = async () => {
    if (transferGuest.isPending) return;
    setTransferError('');
    try {
      await transferGuest.mutateAsync({ data: { confirmed: true } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListVerifiedGuidesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getSearchLibraryQueryKey() }),
      ]);
      setTransferOpen(false);
      setTransferDismissed(true);
    } catch {
      setTransferError('Your guest notes were not transferred. They are still available in the guest workspace. Please try again.');
    }
  };
  const pageLabel = location === '/'
    ? 'Workspace'
    : location.startsWith('/review')
      ? 'Review Hub'
      : location.startsWith('/library/')
        ? 'Verified guide'
        : location === '/library'
          ? 'Verified Library'
          : location.slice(1);
  const toggleTheme = () => setTheme((current) => {
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('living-study-theme', next);
    return next;
  });
  const confirmDelete = async () => {
    if (!notePendingDelete || deleteNote.isPending) return;
    const noteId = notePendingDelete.id;
    try {
      await deleteNote.mutateAsync({ noteId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(noteId) }),
        queryClient.invalidateQueries({ queryKey: getListVerifiedGuidesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getFetchVerifiedGuideQueryKey(noteId) }),
        queryClient.invalidateQueries({ queryKey: getSearchLibraryQueryKey() }),
      ]);
      const currentPath = decodeURIComponent(location);
      if (currentPath === `/library/${noteId}` || currentPath === `/review/${noteId}`) {
        setLocation('/');
      }
      setNotePendingDelete(null);
      setDeleteError('');
    } catch (error) {
      setDeleteError(getPdfErrorMessage(error) ?? 'This study session could not be deleted. Please try again.');
    }
  };
  const pending = summary.data?.pending ?? 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" data-testid="link-home-brand">
          <span className="brand-mark"><BookOpenCheck size={19} strokeWidth={1.8} /></span>
          <span>
            <span className="brand-title">Study with Miky</span>
            <span className="brand-subtitle">Make knowledge stay.</span>
          </span>
        </Link>
        <div className="nav-caption">Your study space</div>
        <nav className="nav-list" aria-label="Main navigation">
            <Link href="/" className={`nav-link ${location === '/' ? 'active' : ''}`} data-testid="link-workspace" data-tour="workspace-nav">
            <NotebookPen size={17} /> Workspace
          </Link>
            <Link href="/review" className={`nav-link ${location === '/review' || location.startsWith('/review/') ? 'active' : ''}`} data-testid="link-review" data-tour="review-hub">
            <CheckCheck size={17} /> Review Hub
            {pending > 0 && <span className="nav-count">{pending}</span>}
          </Link>
            <Link href="/library" className={`nav-link ${location === '/library' ? 'active' : ''}`} data-testid="link-library" data-tour="library-nav">
            <Library size={17} /> Verified Library
          </Link>
        </nav>
        <section className="sessions-section" aria-label="Saved note sessions">
          <div className="session-heading">Note sessions</div>
          <nav className="session-list" aria-label="Note sessions">
            {notesQuery.isLoading ? <span className="session-placeholder">Loading sessions…</span> :
              notesQuery.isError ? <span className="session-placeholder">Sessions unavailable</span> :
              notes.length === 0 ? <span className="session-placeholder">Your saved notes appear here.</span> :
              notes.map((note) => (
                <div className="session-item" key={note.id}>
                  <Link
                    href={`/library/${encodeURIComponent(note.id)}`}
                    className={`session-link ${isGuideSelected === note.id || selectedNote === note.id ? 'selected' : ''}`}
                    title={note.title}
                    data-testid={`link-session-${note.id}`}
                  >
                    <FileText size={14} />
                    <span>{note.title}</span>
                  </Link>
                  <button
                    className="session-delete"
                    type="button"
                    aria-label={`Delete session: ${note.title}`}
                    title={`Delete ${note.title}`}
                    data-testid={`button-delete-session-${note.id}`}
                    onClick={() => {
                      setDeleteError('');
                      setNotePendingDelete(note);
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
          </nav>
        </section>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <img src={sidebarMiky} alt="" aria-hidden="true" className="sidebar-miky" />
            <strong>Small steps stick.</strong>
            Review each connection, then keep the ideas worth returning to.
          </div>
        </div>
        <div className="sidebar-foot">A quiet place to make sense of it all</div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="crumb">Study desk <span style={{ color: 'var(--secondary-text)', padding: '0 7px' }}>/</span> {pageLabel}</div>
          <nav className="topbar-nav" aria-label="Quick navigation">
            <Link href="/" className={`quick-tab ${location === '/' ? 'active' : ''}`} aria-current={location === '/' ? 'page' : undefined} data-testid="quick-workspace">Workspace</Link>
            <Link href="/review" className={`quick-tab ${location.startsWith('/review') ? 'active' : ''}`} aria-current={location.startsWith('/review') ? 'page' : undefined} data-testid="quick-review">Review Hub</Link>
            <Link href="/library" className={`quick-tab ${location.startsWith('/library') ? 'active' : ''}`} aria-current={location.startsWith('/library') ? 'page' : undefined} data-testid="quick-library">Verified Library</Link>
          </nav>
          <div className="topbar-right">
          <span data-testid="status-api-health"><i className={`health-dot ${health.isError ? 'offline' : ''}`} />{health.isLoading ? 'Checking service' : health.isError ? 'Service unavailable' : 'Service online'}</span>
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} data-testid="button-theme-toggle">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="profile-wrap">
              <button
                className="user-chip"
                type="button"
                aria-label="Open profile and help menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
                data-testid="button-profile-menu"
              >
                {session?.user?.imageUrl
                  ? <img src={session.user.imageUrl} alt="" />
                  : (session?.user?.name || session?.user?.email || 'M').slice(0, 1).toUpperCase()}
              </button>
              {profileOpen && <div className="profile-menu" role="menu" data-testid="menu-profile">
                <div className="profile-menu-user">
                  <strong>{session?.user?.name || (session?.kind === 'guest' ? 'Guest workspace' : 'Your workspace')}</strong>
                  {session?.user?.email && <span>{session.user.email}</span>}
                </div>
                <button type="button" role="menuitem" onClick={() => void replayTour()} disabled={updateOnboarding.isPending} data-testid="button-replay-tour">Replay Tour</button>
                {session?.kind === 'guest'
                  ? <Link href="/sign-up" role="menuitem" onClick={() => setProfileOpen(false)} data-testid="link-create-account">Create account</Link>
                  : session?.kind === 'user' && <button type="button" role="menuitem" onClick={() => void signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Sign out</button>}
                {session?.kind === 'user' && session.guestAvailable && <button type="button" role="menuitem" onClick={() => { setTransferError(''); setTransferOpen(true); setProfileOpen(false); }} data-testid="button-open-transfer">Transfer guest notes</button>}
              </div>}
            </div>
          </div>
        </header>
        {children}
      </main>
      <OnboardingTour
        open={tourOpen}
        step={tourStep}
        onClose={() => setTourOpen(false)}
        onFinish={() => {
          setTourOpen(false);
          setLocation('/');
          refreshAuthSession();
        }}
        onStepChange={setTourStep}
        onProgressSaved={refreshAuthSession}
      />
      {transferOpen && session?.kind === 'user' && session.guestAvailable && <div className="transfer-overlay">
        <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title" data-testid="dialog-guest-transfer">
          <span className="eyebrow">WELCOME TO YOUR ACCOUNT</span>
          <h2 id="transfer-title">Bring your guest notes along?</h2>
          <p>Transfer the notes from this guest workspace into your account. You can choose not to transfer them.</p>
          {transferError && <p className="transfer-error" role="alert" data-testid="text-transfer-error">{transferError}</p>}
          <div className="transfer-actions">
            <button type="button" className="btn btn-outline" onClick={() => { setTransferOpen(false); setTransferDismissed(true); }} disabled={transferGuest.isPending} data-testid="button-transfer-later">Not now</button>
            <button type="button" className="btn btn-primary" onClick={() => void confirmGuestTransfer()} disabled={transferGuest.isPending} data-testid="button-transfer-confirm">
              {transferGuest.isPending ? 'Transferring…' : 'Transfer guest notes'}
            </button>
          </div>
        </section>
      </div>}
      <AlertDialog
        open={Boolean(notePendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteNote.isPending) {
            setNotePendingDelete(null);
            setDeleteError('');
          }
        }}
      >
        <AlertDialogContent className="delete-session-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this study session?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {notePendingDelete?.title}? Its associated study materials may also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="delete-session-error" role="alert">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteNote.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="delete-session-confirm"
              disabled={deleteNote.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteNote.isPending ? 'Deleting…' : 'Delete session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return <div aria-label="Loading" style={{ display: 'grid', gap: 11 }}>
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 20 : 13, width: `${92 - i * 13}%` }} />)}
  </div>;
}

function ErrorNotice({ retry, message = 'That didn’t come through. Try once more.' }: { retry: () => void; message?: string }) {
  return <div className="error-box" role="alert">
    <span>{message}</span>
    <button className="btn btn-outline btn-small" onClick={retry} data-testid="button-retry">Retry</button>
  </div>;
}

function HomePage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const notesQuery = useListNotes();
  const summaryQuery = useGetStudySummary();
  const createNote = useCreateNote();
  const pdfTextMutation = useExtractPdfText();
  const extractPack = useExtractStudyPack();
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const pdfRequestId = useRef(0);
  const busy = createNote.isPending || extractPack.isPending || pdfExtracting;
  const notes = (notesQuery.data ?? []) as NoteRecord[];
  const summary = summaryQuery.data;

  const pickFile = async (file?: File) => {
    if (!file) return;
    const requestId = ++pdfRequestId.current;
    const isPdf = /\.pdf$/i.test(file.name);
    const isText = /\.(txt|md|markdown)$/i.test(file.name);
    if (!isPdf && !isText) {
      setPdfExtracting(false);
      setPdfPageCount(null);
      setFileName('');
      setError('Please choose a .txt, .md, or .pdf file.');
      return;
    }
    if (isPdf) {
      setPdfExtracting(true);
      setPdfPageCount(null);
      setRawText('');
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
      setError('');
      try {
        const result = await pdfTextMutation.mutateAsync({ data: { file } });
        if (requestId !== pdfRequestId.current) return;
        setRawText(result.text);
        setPdfPageCount(result.pageCount);
      } catch (extractionError) {
        if (requestId !== pdfRequestId.current) return;
        setError(
          getPdfErrorMessage(extractionError) ||
            'The PDF text could not be extracted. Try another text-based PDF.',
        );
      } finally {
        if (requestId === pdfRequestId.current) setPdfExtracting(false);
      }
      return;
    }
    setPdfExtracting(false);
    setPdfPageCount(null);
    try {
      const text = await file.text();
      if (requestId !== pdfRequestId.current) return;
      setRawText(text);
      setPdfPageCount(null);
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, '').replace(/[-_]/g, ' '));
      setError('');
    } catch {
      if (requestId === pdfRequestId.current) {
        setError('We couldn’t open that file. You can paste the notes instead.');
      }
    }
  };

  const handleExtract = async () => {
    if (!title.trim() || !rawText.trim()) {
      setError('Add a title and some notes first. A few clear paragraphs work beautifully.');
      return;
    }
    setError('');
    try {
      const note = await createNote.mutateAsync({ data: { title: title.trim(), rawText: rawText.trim() } });
      const extraction = await extractPack.mutateAsync({ noteId: note.id });
      sessionStorage.setItem(`study-pack-mode:${note.id}`, extraction.mode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(note.id) }),
        queryClient.invalidateQueries({ queryKey: getListVerifiedGuidesQueryKey() }),
      ]);
      setLocation(`/review/${encodeURIComponent(note.id)}`);
    } catch {
      setError('We couldn’t make the study pack just now. Your note may already be saved—please try again.');
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
    }
  };

  return <div className="content">
    <div className="welcome-hero" data-tour="workspace-welcome">
      <div className="welcome-copy">
        <div className="eyebrow">YOUR LITTLE LEARNING COMPANION</div>
        <h1 className="page-title">Let’s make learning stick!</h1>
        <p className="page-intro">Bring your notes, and I’ll help turn them into questions and knowledge worth keeping.</p>
      </div>
      <div className="welcome-stage">
        <span className="welcome-spark welcome-spark-one" aria-hidden="true" />
        <span className="welcome-spark welcome-spark-two" aria-hidden="true" />
        <span className="welcome-spark welcome-spark-three" aria-hidden="true" />
        <img className="miky-welcome" src={welcomeMiky} alt="Miky, your learning companion" />
      </div>
    </div>

    <div className="workspace-grid">
      <section className="panel note-panel" data-tour="study-material">
        <div className="panel-heading">
          <div><h2>Start with your notes</h2><p>Paste notes or add a text or PDF file.</p></div>
          <span className="step-tag">01 / 03</span>
        </div>
        <label className="field-label" htmlFor="note-title">Note title</label>
        <input id="note-title" className="text-input" placeholder="e.g. Memory & learning — Week 04" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} data-testid="input-note-title" />
        <label className="field-label" htmlFor="note-content">Your notes</label>
        <textarea id="note-content" className="text-area" placeholder={pdfExtracting ? 'Extracting text from your PDF…' : 'Paste your lecture notes here…\n\nA few ideas, a half-formed thought, a quote worth keeping. Start anywhere.'} value={rawText} onChange={(event) => { pdfRequestId.current += 1; setPdfExtracting(false); setRawText(event.target.value); }} data-testid="input-note-content" />
        <div className="input-meta" aria-live="polite"><span>{pdfExtracting ? 'Extracting PDF text…' : rawText.trim() ? `${rawText.trim().split(/\s+/).length} words${pdfPageCount ? ` · ${pdfPageCount} PDF pages extracted` : ''}` : 'Nothing here yet'}</span><span>{fileName || 'Paste or upload notes'}</span></div>
        <div className="upload-row">
          <label className="upload-label">
            <Upload size={15} />
            <span>{fileName ? 'Choose another file' : 'Upload .txt, .md, or .pdf'}</span>
            <input type="file" accept=".txt,.md,.pdf,.markdown,text/plain,text/markdown,application/pdf" onChange={(event) => { void pickFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-notes-file" />
          </label>
          <button className="btn btn-primary" onClick={handleExtract} disabled={busy} data-testid="button-extract-pack" data-tour="make-pack">
            {busy ? <><LoaderCircle size={15} className="animate-spin" /> {pdfExtracting ? 'Extracting PDF text…' : createNote.isPending ? 'Saving note…' : 'Finding the ideas…'}</> : <>Make my study pack <Sparkles size={15} /></>}
          </button>
        </div>
        {error && <p className="notice" role="alert">{error}</p>}
      </section>

      <div className="side-stack">
        <section className="panel summary-panel">
          <h2 className="summary-title">Your study, so far</h2>
          {summaryQuery.isLoading ? <LoadingBlock lines={3} /> : summaryQuery.isError ? <ErrorNotice retry={() => summaryQuery.refetch()} /> : (
            <div className="summary-rows">
              <div className="summary-row"><span>Notes collected</span><strong className="summary-number">{summary?.notes ?? 0}</strong></div>
              <div className="summary-row"><span>Waiting for your eye</span><strong className="summary-number">{summary?.pending ?? 0}</strong></div>
              <div className="summary-row"><span>Knowledge kept</span><strong className="summary-number">{summary?.approved ?? 0}</strong></div>
            </div>
          )}
        </section>
        <section className="panel recent-panel">
          <div className="recent-header"><h3>Recent notes</h3><Link className="text-link" href="/review">Review cards</Link></div>
          {notesQuery.isLoading ? <LoadingBlock lines={2} /> : notesQuery.isError ? <ErrorNotice retry={() => notesQuery.refetch()} /> : notes.length === 0 ? (
            <div style={{ color: 'var(--secondary-text)', fontSize: 12, lineHeight: 1.7 }}>Nothing here just yet. Let’s start with your first set of notes!</div>
          ) : notes.slice(0, 3).map((note) => (
            <div className="recent-note" key={note.id} data-testid={`note-recent-${note.id}`}>
              <FileText className="recent-note-icon" size={15} />
              <div><div className="recent-note-title">{note.title}</div><div className="recent-note-time">{formatDate(note.createdAt)}</div></div>
            </div>
          ))}
        </section>
      </div>
    </div>
    <div className="how-strip">
      <div className="how-item"><strong>Bring it in</strong>Keep the original words close while the important ideas take shape.</div>
      <div className="how-item"><strong>Check the connection</strong>Every card points back to the line that inspired it.</div>
      <div className="how-item"><strong>Keep what holds up</strong>Approve, refine, and build a library that feels like yours.</div>
    </div>
  </div>;
}

function ReviewPage() {
  const queryClient = useQueryClient();
  const notesQuery = useListNotes();
  const notes = (notesQuery.data ?? []) as NoteRecord[];
  const [, setLocation] = useLocation();
  const params = useParams<{ noteId?: string }>();
  const [editing, setEditing] = useState(false);
  const [concept, setConcept] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [generationMode, setGenerationMode] = useState('');
  const [actionError, setActionError] = useState('');
  const requestedId = params.noteId || '';
  const chosenId = requestedId || notes[0]?.id || '';
  const cardsQuery = useListNoteCards(chosenId, { query: { queryKey: getListNoteCardsQueryKey(chosenId), enabled: !!chosenId } });
  const reviewCard = useReviewCard();
  const generateMore = useGenerateMoreCards();
  const cards = (cardsQuery.data ?? []) as CardRecord[];
  const pendingCards = useMemo(() => cards.filter((card) => card.status === 'pending'), [cards]);
  const current = pendingCards[0];
  const [canGenerateMore, setCanGenerateMore] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationExhausted, setGenerationExhausted] = useState(false);
  const [verifiedToast, setVerifiedToast] = useState(false);

  useEffect(() => {
    if (current) {
      setConcept(current.concept);
      setQuestion(current.question);
      setAnswer(current.answer);
      setEditing(false);
    }
  }, [current?.id]);

  useEffect(() => {
    if (!chosenId) {
      setGenerationMode('');
      return;
    }
    setGenerationMode(sessionStorage.getItem(`study-pack-mode:${chosenId}`) || 'unknown');
  }, [chosenId]);

  useEffect(() => {
    setGenerationError('');
    const exhausted = chosenId
      ? sessionStorage.getItem(`study-pack-more-exhausted:${chosenId}`) === 'true'
      : false;
    const hasCards = cardsQuery.isSuccess && cards.some((card) => card.noteId === chosenId);
    setGenerationExhausted(exhausted);
    setCanGenerateMore(hasCards && !exhausted);
  }, [cardsQuery.isSuccess, chosenId, cards.length]);

  const refresh = async (card: CardRecord) => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(card.noteId) }),
    queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getSearchLibraryQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListVerifiedGuidesQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getFetchVerifiedGuideQueryKey(card.noteId) }),
  ]);

  const requestMore = async () => {
    if (!chosenId) return;
    setGenerationError('');
    setGenerationExhausted(false);
    try {
      const result = await generateMore.mutateAsync({ noteId: chosenId });
      setCanGenerateMore(result.hasMore);
      setGenerationExhausted(!result.hasMore);
      sessionStorage.setItem(`study-pack-mode:${chosenId}`, result.mode);
      if (result.hasMore) {
        sessionStorage.removeItem(`study-pack-more-exhausted:${chosenId}`);
      } else {
        sessionStorage.setItem(`study-pack-more-exhausted:${chosenId}`, 'true');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(chosenId) }),
        queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getSearchLibraryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListVerifiedGuidesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getFetchVerifiedGuideQueryKey(chosenId) }),
      ]);
    } catch {
      setGenerationError('Couldn’t find more cards just now.');
      setCanGenerateMore(true);
    }
  };

  const submitReview = async (action: 'approve' | 'edit_approve' | 'discard') => {
    if (!current) return;
    setActionError('');
    try {
      await reviewCard.mutateAsync({
        cardId: current.id,
        data: action === 'edit_approve'
          ? { action, concept: concept.trim(), question: question.trim(), answer: answer.trim() }
          : { action },
      });
      if (action === 'approve' || action === 'edit_approve') {
        setVerifiedToast(true);
        window.setTimeout(() => setVerifiedToast(false), 1300);
      }
      await refresh(current);
    } catch {
      setActionError('That change didn’t save. Your card is still here—please try again.');
    }
  };

  const onSelectNote = (value: string) => setLocation(`/review/${encodeURIComponent(value)}`);

  return <div className="content">
    <div className="eyebrow">MIKY HAS SOMETHING FOR YOU</div>
    <h1 className="page-title">Let’s check what we’ve learned!</h1>
    <p className="page-intro">I’ve prepared some questions from your notes. Let’s go through them together and keep the ones that make sense.</p>
    <div className="review-layout" data-tour="review-actions">
      <div className="review-controls">
        <span>{pendingCards.length ? `${pendingCards.length} card${pendingCards.length === 1 ? '' : 's'} to look over` : 'Your review queue'}</span>
        {notes.length > 0 && <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>From</span>
          <select aria-label="Choose notes" value={chosenId} onChange={(event) => onSelectNote(event.target.value)} className="text-input" style={{ width: 'auto', minWidth: 180, height: 35, fontSize: 11 }} data-testid="select-review-note">
            {notes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
          </select>
          <ChevronDown size={13} style={{ display: 'none' }} />
        </label>}
      </div>
      <div className="generation-controls" aria-live="polite">
        {canGenerateMore && <button className="btn btn-outline btn-small" type="button" onClick={requestMore} disabled={generateMore.isPending} data-testid="button-generate-more">
          {generateMore.isPending ? 'There’s more to explore! Let me find a few more interesting questions.' : 'Ask Miky for more questions'} {!generateMore.isPending && <Sparkles size={13} />}
        </button>}
        {generationError && <span className="inline-error" role="alert" data-testid="text-generation-error">{generationError}</span>}
        {generationExhausted && <span className="generation-exhausted" data-testid="text-generation-exhausted">You’re all caught up! We’ve covered all the useful ideas in these notes. Great work!</span>}
      </div>
      {notesQuery.isLoading ? <div className="panel" style={{ padding: 25 }}><LoadingBlock lines={4} /></div> :
        notesQuery.isError ? <ErrorNotice retry={() => notesQuery.refetch()} /> :
        cardsQuery.isLoading ? <div className="panel" style={{ padding: 25 }}><LoadingBlock lines={5} /></div> :
        cardsQuery.isError ? <ErrorNotice retry={() => cardsQuery.refetch()} /> :
        !current ? (
            <div className="review-empty">
            <div className="empty-mark"><Check size={22} /></div>
            <h2>{notes.length ? 'Nothing waiting on you.' : 'Let’s begin with your notes.'}</h2>
            <p>{notes.length ? 'Your queue is clear for this set of notes. New cards will appear here after you make another study pack.' : 'Nothing here just yet. Let’s start with your first set of notes!'}</p>
            <Link href="/" className="btn btn-primary" data-testid="link-review-workspace">Back to workspace <ArrowDownToLine size={14} /></Link>
          </div>
        ) : (
          <article className="review-card" data-testid={`review-card-${current.id}`}>
            <div className="review-card-top">
              <span className="concept-label">{current.concept}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className={`source-badge generation-mode ${generationMode === 'demo' ? 'demo-mode' : ''}`} data-testid="status-generation-mode">
                  <Sparkles size={12} /> {generationMode === 'demo' ? 'Demo-generated' : generationMode === 'ai' ? 'AI-generated' : 'Source not recorded'}
                </span>
                <span className="source-badge"><ArrowLeftRight size={13} /> Linked to source</span>
              </div>
            </div>
            <div className="review-columns">
              <section className="source-column">
                <div className="column-label"><FileText size={13} /> From your notes</div>
                <blockquote className="source-quote">“{current.sourceExcerpt}”</blockquote>
              </section>
              <section className="card-column">
                <div className="column-label"><BookOpenCheck size={13} /> Study card</div>
                <div className="card-field">
                  <label>Concept</label>
                  {editing ? <input value={concept} onChange={(event) => setConcept(event.target.value)} data-testid="input-edit-concept" /> : <p>{current.concept}</p>}
                </div>
                <div className="card-field">
                  <label>Question</label>
                  {editing ? <textarea value={question} onChange={(event) => setQuestion(event.target.value)} data-testid="input-edit-question" /> : <p>{current.question}</p>}
                </div>
                <div className="card-field">
                  <label>Answer</label>
                  {editing ? <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} data-testid="input-edit-answer" /> : <p>{current.answer}</p>}
                </div>
              </section>
            </div>
            <div className="review-actions">
              {actionError ? <span className="notice" role="alert">{actionError}</span> : <span style={{ color: 'var(--secondary-text)', fontSize: 10 }}>You can always come back to what you keep.</span>}
              <div className="action-group">
                {editing ? <>
                  <button className="btn btn-outline btn-small" onClick={() => { setEditing(false); setConcept(current.concept); setQuestion(current.question); setAnswer(current.answer); }} data-testid="button-cancel-edit">Cancel</button>
                  <button className="btn btn-primary btn-small" disabled={reviewCard.isPending || !concept.trim() || !question.trim() || !answer.trim()} onClick={() => submitReview('edit_approve')} data-testid="button-save-edit">
                    {reviewCard.isPending ? 'Saving…' : <>Save & Verify <CheckCircle2 size={14} /></>}
                  </button>
                </> : <>
                  <button className="btn btn-outline btn-small" disabled={reviewCard.isPending} onClick={() => setEditing(true)} data-testid="button-edit-card"><Pencil size={14} /> Edit</button>
                  <button className="btn btn-primary btn-small" disabled={reviewCard.isPending} onClick={() => submitReview('approve')} data-testid="button-approve-card">
                    {reviewCard.isPending ? 'Saving…' : <>Verify <CheckCircle2 size={15} /></>}
                  </button>
                  <button className="btn btn-outline btn-small btn-discard" disabled={reviewCard.isPending} onClick={() => submitReview('discard')} data-testid="button-discard-card"><X size={14} /> Discard</button>
                </>}
              </div>
            </div>
          </article>
        )}
      {verifiedToast && <div className="miky-toast" role="status" aria-live="polite" data-testid="toast-verified-card">
        <img src={sidebarMiky} alt="" aria-hidden="true" />
        <span>Miky delivered it to your Verified Library!</span>
      </div>}
    </div>
  </div>;
}

function LibraryPage() {
  const [query, setQuery] = useState('');
  const normalized = query.trim();
  const libraryQuery = useSearchLibrary(normalized ? { query: normalized } : undefined);
  const guidesQuery = useListVerifiedGuides();
  const cards = (libraryQuery.data ?? []) as LibraryRecord[];

  return <div className="content" data-tour="verified-library">
    <div className="eyebrow">YOUR GROWING KNOWLEDGE COLLECTION</div>
    <h1 className="page-title">Look how much you’ve learned!</h1>
    <p className="page-intro">Every verified card is another little piece of knowledge worth keeping.</p>
    <div className="library-toolbar">
      <div className="search-wrap">
        <Search size={16} />
        <input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your knowledge…" aria-label="Search library" data-testid="input-library-search" />
      </div>
      <span className="library-count" data-testid="text-library-count">{guidesQuery.isLoading ? 'Gathering guides…' : `${guidesQuery.data?.length ?? 0} ${guidesQuery.data?.length === 1 ? 'guide' : 'guides'}`}</span>
    </div>
    {guidesQuery.isError ? <ErrorNotice retry={() => guidesQuery.refetch()} /> :
      libraryQuery.isError ? <ErrorNotice retry={() => libraryQuery.refetch()} /> :
      guidesQuery.isLoading || libraryQuery.isLoading ? <div className="guide-list">
        {[0, 1, 2].map((item) => <div className="panel guide-row" key={item}><LoadingBlock lines={3} /></div>)}
      </div> :
      guidesQuery.data?.length ? <div className="guide-list">
        {guidesQuery.data.map((guide, index) => {
          return <Link href={`/library/${encodeURIComponent(guide.noteId)}`} className="guide-row" key={guide.noteId} style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }} data-testid={`link-guide-${guide.noteId}`}>
            <div className="guide-index">{String(index + 1).padStart(2, '0')}</div>
            <div className="guide-main">
              <span className="guide-kicker">Verified guide</span>
              <h2>{guide.title}</h2>
              <span className="guide-detail">{guide.approvedCount} {guide.approvedCount === 1 ? 'card' : 'cards'} kept</span>
            </div>
            <span className="guide-arrow" aria-hidden="true">↗</span>
          </Link>;
        })}
      </div> : (
        <div className="review-empty empty-library">
          <div className="empty-mark"><Library size={21} /></div>
          <h2>{normalized ? 'No guides found.' : 'Your knowledge collection is ready to grow.'}</h2>
          <p>{normalized ? 'Try a different word or a broader idea.' : 'Nothing here just yet. Let’s start with your first set of notes!'}</p>
          {!normalized && <Link href="/review" className="btn btn-quiet" data-testid="link-library-review">Go to review <BookOpenCheck size={14} /></Link>}
        </div>
      )}
    {normalized && !libraryQuery.isLoading && !libraryQuery.isError && cards.length > 0 && <section className="library-search-results" aria-label="Matching saved cards">
      <div className="results-heading"><span className="guide-kicker">Across your library</span><span className="library-count">{cards.length} matching {cards.length === 1 ? 'card' : 'cards'}</span></div>
      <div className="library-grid">
        {cards.map((card) => <article key={card.id} className="library-card" data-testid={`library-search-card-${card.id}`}>
          <div className="library-card-top"><span className="library-concept">{card.concept}</span><span className="verified-pill"><Check size={12} /> Verified</span></div>
          <h2 className="library-question">{card.question}</h2>
          <p className="library-answer">{card.answer}</p>
          <div className="library-card-foot"><span>{formatDate(card.createdAt)}</span>{card.editedByUser && <span className="edited-tag">In your words</span>}</div>
        </article>)}
      </div>
    </section>}
    {normalized && !libraryQuery.isLoading && !libraryQuery.isError && cards.length === 0 && <div className="search-no-results" role="status" data-testid="text-library-no-results">No saved cards match that search.</div>}
  </div>;
}

function GuideDetailPage() {
  const params = useParams<{ noteId: string }>();
  const noteId = params.noteId || '';
  const [query, setQuery] = useState('');
  const guideQuery = useFetchVerifiedGuide(noteId, { query: { queryKey: getFetchVerifiedGuideQueryKey(noteId), enabled: !!noteId } });
  const guide = guideQuery.data;
  const normalized = query.trim().toLowerCase();
  const cards = (guide?.cards ?? []).filter((card) => !normalized || [card.concept, card.question, card.answer, card.sourceExcerpt].some((part) => part.toLowerCase().includes(normalized)));

  return <div className="content">
    <Link href="/library" className="back-link" data-testid="link-guide-back"><ArrowDownToLine size={14} /> All verified guides</Link>
    {guideQuery.isLoading ? <div className="guide-detail-loading"><LoadingBlock lines={5} /></div> :
      guideQuery.isError ? <ErrorNotice retry={() => guideQuery.refetch()} /> :
      !guide ? <div className="review-empty"><h2>This guide isn’t available.</h2><p>It may not have any approved cards yet.</p><Link href="/library" className="btn btn-quiet">Back to library</Link></div> :
      <>
        <div className="eyebrow">Note session · {cards.length} of {guide.cards.length} cards</div>
        <h1 className="page-title guide-title">{guide.title}</h1>
        <p className="page-intro">Approved ideas, kept beside the exact excerpt that grounds each one.</p>
        <div className="library-toolbar">
          <div className="search-wrap">
            <Search size={16} />
            <input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this guide…" aria-label="Search this note guide" data-testid="input-guide-search" />
          </div>
          <span className="library-count" data-testid="text-guide-card-count">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
        </div>
        {cards.length ? <div className="guide-card-list">
          {cards.map((card, index) => <article className="guide-card" key={card.id} data-testid={`guide-card-${card.id}`} style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }}>
            <div className="guide-card-content">
              <div className="library-card-top"><span className="library-concept">{card.concept}</span><span className="verified-pill"><Check size={12} /> Verified</span></div>
              <h2 className="library-question">{card.question}</h2>
              <p className="library-answer">{card.answer}</p>
            </div>
            <div className="guide-source">
              <span className="column-label"><FileText size={13} /> Exact source excerpt</span>
              <blockquote className="source-quote">“{card.sourceExcerpt}”</blockquote>
              <div className="library-card-foot"><span>{formatDate(card.createdAt)}</span>{card.editedByUser && <span className="edited-tag">In your words</span>}</div>
            </div>
          </article>)}
        </div> : <div className="review-empty"><div className="empty-mark"><Search size={20} /></div><h2>{normalized ? 'No cards match that search.' : 'No approved cards yet.'}</h2><p>{normalized ? 'Try a different phrase from this guide.' : 'Cards appear here after they are approved in review.'}</p></div>}
      </>}
  </div>;
}

function NotFound() {
  return <div className="content">
    <div className="eyebrow">A page not in these notes</div>
    <h1 className="page-title">Let’s find<br />our way back.</h1>
    <p className="page-intro">This page isn’t part of your study space.</p>
    <Link className="btn btn-primary" href="/" style={{ marginTop: 22 }}>Return to workspace</Link>
  </div>;
}

function HomeRoute() {
  const sessionQuery = useGetAuthSession({
    query: { queryKey: getGetAuthSessionQueryKey(), staleTime: 0, refetchOnMount: 'always' },
  });
  const kind = sessionQuery.data?.kind;
  if (sessionQuery.isLoading) {
    return <main className="public-loading" aria-label="Loading your workspace"><div className="loading-orbit" /></main>;
  }
  if (kind === 'guest' || kind === 'user') return <Shell><HomePage /></Shell>;
  return <PublicEntry />;
}

function WorkspaceRouter() {
  const [location, setLocation] = useLocation();
  const sessionQuery = useGetAuthSession({
    query: { queryKey: getGetAuthSessionQueryKey(), staleTime: 0, refetchOnMount: 'always' },
  });
  const kind = sessionQuery.data?.kind;
  useEffect(() => {
    if (kind === 'anonymous' || sessionQuery.isError) setLocation('/');
  }, [kind, sessionQuery.isError, setLocation]);
  if (sessionQuery.isLoading || sessionQuery.isError) {
    return <main className="public-loading" aria-label="Loading your workspace"><div className="loading-orbit" /></main>;
  }
  if (kind !== 'guest' && kind !== 'user') return null;
  return <ErrorBoundary resetKey={location}>
    <Shell>
      <Switch>
        <Route path="/review/:noteId" component={ReviewPage} />
        <Route path="/review" component={ReviewPage} />
        <Route path="/library/:noteId" component={GuideDetailPage} />
        <Route path="/library" component={LibraryPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  </ErrorBoundary>;
}

function SignInPage() {
  return <main className="auth-page">
    <Link href="/" className="auth-brand" data-testid="link-auth-brand">
      <span className="brand-mark"><BookOpenCheck size={19} strokeWidth={1.8} /></span>
      <span><strong>Study with Miky</strong><small>Make knowledge stay.</small></span>
    </Link>
    <SignIn
      routing="path"
      path={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      forceRedirectUrl={`${basePath}/`}
      appearance={clerkAppearance}
    />
  </main>;
}

function SignUpPage() {
  return <main className="auth-page">
    <Link href="/" className="auth-brand" data-testid="link-auth-brand">
      <span className="brand-mark"><BookOpenCheck size={19} strokeWidth={1.8} /></span>
      <span><strong>Study with Miky</strong><small>Make knowledge stay.</small></span>
    </Link>
    <SignUp
      routing="path"
      path={`${basePath}/sign-up`}
      signInUrl={`${basePath}/sign-in`}
      forceRedirectUrl={`${basePath}/`}
      appearance={clerkAppearance}
    />
  </main>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Continue to your private study space' } },
      signUp: { start: { title: 'Make a learning space of your own', subtitle: 'Your notes stay yours' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <TooltipProvider>
        <Switch>
          <Route path="/" component={HomeRoute} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={WorkspaceRouter} />
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
  return <WouterRouter base={basePath}>
    <ClerkRoutes />
  </WouterRouter>;
}

export default App;
