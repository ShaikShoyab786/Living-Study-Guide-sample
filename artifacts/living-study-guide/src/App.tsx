import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  useCreateNote,
  useExtractStudyPack,
  useGetStudySummary,
  useHealthCheck,
  useListNoteCards,
  useListNotes,
  useReviewCard,
  useSearchLibrary,
  getGetStudySummaryQueryKey,
  getListNoteCardsQueryKey,
  getListNotesQueryKey,
  getSearchLibraryQueryKey,
} from '@workspace/api-client-react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpenCheck,
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  Library,
  LoaderCircle,
  NotebookPen,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } },
});

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

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const summary = useGetStudySummary();
  const health = useHealthCheck();
  const notesQuery = useListNotes();
  const notes = (notesQuery.data ?? []) as NoteRecord[];
  const selectedNote = location.startsWith('/review/') ? decodeURIComponent(location.slice('/review/'.length)) : '';
  const pending = summary.data?.pending ?? 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" data-testid="link-home-brand">
          <span className="brand-mark"><BookOpenCheck size={19} strokeWidth={1.8} /></span>
          <span>
            <span className="brand-title">Living Study</span>
            <span className="brand-subtitle">your learning, in progress</span>
          </span>
        </Link>
        <div className="nav-caption">Your study space</div>
        <nav className="nav-list" aria-label="Main navigation">
          <Link href="/" className={`nav-link ${location === '/' ? 'active' : ''}`} data-testid="link-workspace">
            <NotebookPen size={17} /> Workspace
          </Link>
          <Link href="/review" className={`nav-link ${location === '/review' || location.startsWith('/review/') ? 'active' : ''}`} data-testid="link-review">
            <CheckCheck size={17} /> Review
            {pending > 0 && <span className="nav-count">{pending}</span>}
          </Link>
          <Link href="/library" className={`nav-link ${location === '/library' ? 'active' : ''}`} data-testid="link-library">
            <Library size={17} /> Verified guides
          </Link>
        </nav>
        <div className="session-heading">Note sessions</div>
        <nav className="session-list" aria-label="Note sessions">
          {notesQuery.isLoading ? <span className="session-placeholder">Loading sessions…</span> :
            notesQuery.isError ? <span className="session-placeholder">Sessions unavailable</span> :
            notes.length === 0 ? <span className="session-placeholder">Your saved notes appear here.</span> :
            notes.map((note) => (
              <Link
                href={`/review/${encodeURIComponent(note.id)}`}
                className={`session-link ${selectedNote === note.id ? 'selected' : ''}`}
                key={note.id}
                title={note.title}
                data-testid={`link-session-${note.id}`}
              >
                <FileText size={14} />
                <span>{note.title}</span>
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <strong>Small steps stick.</strong>
            Review each connection, then keep the ideas worth returning to.
          </div>
        </div>
        <div className="sidebar-foot">A quiet place to make sense of it all</div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="crumb">Study desk <span style={{ color: '#c2aa96', padding: '0 7px' }}>/</span> {location === '/' ? 'Workspace' : location.slice(1)}</div>
          <div className="topbar-right">
          <span data-testid="status-api-health"><i className={`health-dot ${health.isError ? 'offline' : ''}`} />{health.isLoading ? 'Checking service' : health.isError ? 'Service unavailable' : 'Service online'}</span>
            <span className="user-chip" aria-label="Personal workspace">LS</span>
          </div>
        </header>
        {children}
      </main>
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
  const extractPack = useExtractStudyPack();
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const busy = createNote.isPending || extractPack.isPending || pdfBusy;
  const notes = (notesQuery.data ?? []) as NoteRecord[];
  const summary = summaryQuery.data;

  const pickFile = async (file?: File) => {
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name);
    const isText = /\.(txt|md|markdown)$/i.test(file.name);
    if (!isPdf && !isText) {
      setSelectedPdf(null);
      setFileName('');
      setError('Please choose a .txt, .md, or .pdf file.');
      return;
    }
    if (isPdf) {
      setSelectedPdf(file);
      setRawText('');
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
      setError('');
      return;
    }
    try {
      setRawText(await file.text());
      setSelectedPdf(null);
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, '').replace(/[-_]/g, ' '));
      setError('');
    } catch {
      setError('We couldn’t open that file. You can paste the notes instead.');
    }
  };

  const handleExtract = async () => {
    if (!title.trim() || (!selectedPdf && !rawText.trim())) {
      setError('Add a title and some notes first. A few clear paragraphs work beautifully.');
      return;
    }
    setError('');
    if (selectedPdf && !rawText.trim()) {
      setPdfBusy(true);
      try {
        const formData = new FormData();
        formData.append('title', title.trim());
        formData.append('file', selectedPdf, selectedPdf.name);
        const response = await fetch('/api/notes/pdf-study-pack', {
          method: 'POST',
          body: formData,
        });
        const payload = await response.json() as {
          note?: NoteRecord;
          mode?: 'ai' | 'demo';
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'The PDF could not be processed.');
        if (!payload.note || !payload.mode) throw new Error('The PDF study pack response was incomplete.');

        sessionStorage.setItem(`study-pack-mode:${payload.note.id}`, payload.mode);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(payload.note.id) }),
        ]);
        setLocation(`/review?noteId=${encodeURIComponent(payload.note.id)}`);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'The PDF could not be processed.');
      } finally {
        setPdfBusy(false);
      }
      return;
    }
    try {
      const note = await createNote.mutateAsync({ data: { title: title.trim(), rawText: rawText.trim() } });
      const extraction = await extractPack.mutateAsync({ noteId: note.id });
      sessionStorage.setItem(`study-pack-mode:${note.id}`, extraction.mode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(note.id) }),
      ]);
      setLocation(`/review?noteId=${encodeURIComponent(note.id)}`);
    } catch {
      setError('We couldn’t make the study pack just now. Your note may already be saved—please try again.');
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
    }
  };

  return <div className="content">
    <div className="eyebrow">A little clarity, one note at a time</div>
    <h1 className="page-title">Turn your notes<br />into understanding.</h1>
    <p className="page-intro">Bring in a lecture, a reading, or a messy page of thoughts. We’ll shape it into source-linked cards for you to check and keep.</p>

    <div className="workspace-grid">
      <section className="panel note-panel">
        <div className="panel-heading">
          <div><h2>Start with your notes</h2><p>Paste notes or add a text or PDF file.</p></div>
          <span className="step-tag">01 / 03</span>
        </div>
        <label className="field-label" htmlFor="note-title">Note title</label>
        <input id="note-title" className="text-input" placeholder="e.g. Memory & learning — Week 04" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} data-testid="input-note-title" />
        <label className="field-label" htmlFor="note-content">Your notes</label>
        <textarea id="note-content" className="text-area" placeholder={selectedPdf ? 'Your PDF text will be extracted when you make the study pack.' : 'Paste your lecture notes here…&#10;&#10;A few ideas, a half-formed thought, a quote worth keeping. Start anywhere.'} value={rawText} onChange={(event) => { setRawText(event.target.value); if (selectedPdf) { setSelectedPdf(null); setFileName(''); } }} data-testid="input-note-content" />
        <div className="input-meta"><span>{rawText.trim() ? `${rawText.trim().split(/\s+/).length} words` : selectedPdf ? 'PDF ready to process' : 'Nothing here yet'}</span><span>{fileName || 'Paste or upload notes'}</span></div>
        <div className="upload-row">
          <label className="upload-label">
            <Upload size={15} />
            <span>{fileName ? 'Choose another file' : 'Upload .txt, .md, or .pdf'}</span>
            <input type="file" accept=".txt,.md,.pdf,.markdown,text/plain,text/markdown,application/pdf" onChange={(event) => pickFile(event.target.files?.[0])} data-testid="input-notes-file" />
          </label>
          <button className="btn btn-primary" onClick={handleExtract} disabled={busy} data-testid="button-extract-pack">
            {busy ? <><LoaderCircle size={15} className="animate-spin" /> {pdfBusy ? 'Reading PDF…' : createNote.isPending ? 'Saving note…' : 'Finding the ideas…'}</> : <>Make my study pack <Sparkles size={15} /></>}
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
            <div style={{ color: '#969f96', fontSize: 11, lineHeight: 1.6 }}>Your first set of notes will find a home here.</div>
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
  const cards = (cardsQuery.data ?? []) as CardRecord[];
  const pendingCards = useMemo(() => cards.filter((card) => card.status === 'pending'), [cards]);
  const current = pendingCards[0];

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

  const refresh = async (card: CardRecord) => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListNoteCardsQueryKey(card.noteId) }),
    queryClient.invalidateQueries({ queryKey: getGetStudySummaryQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getSearchLibraryQueryKey() }),
  ]);

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
      await refresh(current);
    } catch {
      setActionError('That change didn’t save. Your card is still here—please try again.');
    }
  };

  const onSelectNote = (value: string) => setLocation(`/review/${encodeURIComponent(value)}`);

  return <div className="content">
    <div className="eyebrow">A human check makes knowledge trustworthy</div>
    <h1 className="page-title">Keep the good<br />connections.</h1>
    <p className="page-intro">Look at the note beside its study card. If the idea holds up, keep it. If it needs your words, make it yours.</p>
    <div className="review-layout">
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
      {notesQuery.isLoading ? <div className="panel" style={{ padding: 25 }}><LoadingBlock lines={4} /></div> :
        notesQuery.isError ? <ErrorNotice retry={() => notesQuery.refetch()} /> :
        cardsQuery.isLoading ? <div className="panel" style={{ padding: 25 }}><LoadingBlock lines={5} /></div> :
        cardsQuery.isError ? <ErrorNotice retry={() => cardsQuery.refetch()} /> :
        !current ? (
          <div className="review-empty">
            <div className="empty-mark"><Check size={22} /></div>
            <h2>Nothing waiting on you.</h2>
            <p>{notes.length ? 'Your queue is clear for this set of notes. New cards will appear here after you make another study pack.' : 'Add a note in your workspace and we’ll bring the first card here for a thoughtful check.'}</p>
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
              {actionError ? <span className="notice" role="alert">{actionError}</span> : <span style={{ color: '#9aa39a', fontSize: 10 }}>You can always come back to what you keep.</span>}
              <div className="action-group">
                {editing ? <>
                  <button className="btn btn-outline btn-small" onClick={() => { setEditing(false); setConcept(current.concept); setQuestion(current.question); setAnswer(current.answer); }} data-testid="button-cancel-edit">Cancel</button>
                  <button className="btn btn-primary btn-small" disabled={reviewCard.isPending || !concept.trim() || !question.trim() || !answer.trim()} onClick={() => submitReview('edit_approve')} data-testid="button-save-edit">
                    {reviewCard.isPending ? 'Saving…' : <>Save & approve <Check size={13} /></>}
                  </button>
                </> : <>
                  <button className="btn btn-danger btn-small" disabled={reviewCard.isPending} onClick={() => submitReview('discard')} data-testid="button-discard-card"><X size={14} /> Discard</button>
                  <button className="btn btn-outline btn-small" disabled={reviewCard.isPending} onClick={() => setEditing(true)} data-testid="button-edit-card">Make it mine</button>
                  <button className="btn btn-primary btn-small" disabled={reviewCard.isPending} onClick={() => submitReview('approve')} data-testid="button-approve-card">
                    {reviewCard.isPending ? 'Saving…' : <>Keep this <Check size={14} /></>}
                  </button>
                </>}
              </div>
            </div>
          </article>
        )}
    </div>
  </div>;
}

function LibraryPage() {
  const [query, setQuery] = useState('');
  const normalized = query.trim();
  const libraryQuery = useSearchLibrary(normalized ? { query: normalized } : undefined);
  const cards = (libraryQuery.data ?? []) as LibraryRecord[];

  return <div className="content">
    <div className="eyebrow">Your verified, saved study guides</div>
    <h1 className="page-title">A library that<br />sounds like you.</h1>
    <p className="page-intro">Your verified cards, gathered in one place. Search by concept, question, or the details you want to bring back.</p>
    <div className="library-toolbar">
      <div className="search-wrap">
        <Search size={16} />
        <input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your knowledge…" aria-label="Search library" data-testid="input-library-search" />
      </div>
      <span className="library-count" data-testid="text-library-count">{libraryQuery.isLoading ? 'Gathering cards…' : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} kept`}</span>
    </div>
    {libraryQuery.isError ? <ErrorNotice retry={() => libraryQuery.refetch()} /> :
      libraryQuery.isLoading ? <div className="library-grid">
        {[0, 1, 2, 3].map((item) => <div className="panel" key={item} style={{ padding: 21 }}><LoadingBlock lines={4} /></div>)}
      </div> :
      cards.length ? <div className="library-grid">
        {cards.map((card, index) => <article key={card.id} className="library-card" style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }} data-testid={`library-card-${card.id}`}>
          <div className="library-card-top">
            <span className="library-concept">{card.concept}</span>
            <span className="verified-pill"><Check size={12} /> Verified</span>
          </div>
          <h2 className="library-question">{card.question}</h2>
          <p className="library-answer">{card.answer}</p>
          <div className="library-card-foot">
            <span>{formatDate(card.createdAt)}</span>
            {card.editedByUser && <span className="edited-tag">In your words</span>}
          </div>
        </article>)}
      </div> : (
        <div className="review-empty empty-library">
          <div className="empty-mark"><Library size={21} /></div>
          <h2>{normalized ? 'No cards found.' : 'Your library is taking shape.'}</h2>
          <p>{normalized ? 'Try a different word or a broader idea.' : 'Once you approve a study card, it will be kept here for easy finding later.'}</p>
          {!normalized && <Link href="/review" className="btn btn-quiet" data-testid="link-library-review">Go to review <BookOpenCheck size={14} /></Link>}
        </div>
      )}
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

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>
    <Shell>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/review/:noteId" component={ReviewPage} />
        <Route path="/review" component={ReviewPage} />
        <Route path="/library" component={LibraryPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  </ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;
