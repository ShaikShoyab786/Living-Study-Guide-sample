import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MockShell } from "./_shared/MockShell";
import "./_group.css";

const currentCards = [
  {
    id: "current-1",
    concept: "Spaced repetition",
    question: "Why does spacing out practice improve recall?",
    answer: "Reviewing information over increasing intervals strengthens retrieval and makes later recall more durable.",
    date: "Oct 24, 2026",
  },
  {
    id: "current-2",
    concept: "Working memory",
    question: "What limits working memory during learning?",
    answer: "Working memory has limited capacity, so new information is easier to process when it connects to familiar ideas.",
    date: "Oct 21, 2026",
  },
  {
    id: "current-3",
    concept: "Retrieval practice",
    question: "How does retrieval practice support learning?",
    answer: "Trying to recall information strengthens access to it more effectively than simply rereading the same material.",
    date: "Oct 19, 2026",
  },
  {
    id: "current-4",
    concept: "Interleaving",
    question: "When is interleaving useful?",
    answer: "Mixing related problem types helps learners identify which strategy fits a new problem.",
    date: "Oct 18, 2026",
  },
];

export function Current() {
  const [query, setQuery] = useState("");
  const cards = useMemo(() => {
    const search = query.trim().toLowerCase();
    return currentCards.filter((card) =>
      !search || [card.concept, card.question, card.answer].some((value) => value.toLowerCase().includes(search)),
    );
  }, [query]);

  return (
    <MockShell active="library" theme="dark-preview">
      <section className="study-content">
        <div className="study-eyebrow">Your verified, saved study guides</div>
        <h1 className="study-title">A library that<br />sounds like you.</h1>
        <p className="study-intro">
          Your verified cards, gathered in one place. Search by concept, question, or the details you want to bring back.
        </p>
        <div className="study-toolbar">
          <label className="study-search">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search your knowledge…"
              aria-label="Search library"
            />
          </label>
          <span className="study-count">{cards.length} {cards.length === 1 ? "card" : "cards"} kept</span>
        </div>
        {cards.length ? (
          <div className="study-old-grid">
            {cards.map((card) => (
              <article className="study-old-card" key={card.id}>
                <div className="study-card-top">
                  <span className="study-concept">{card.concept}</span>
                  <span className="study-verified"><Check size={12} />Verified</span>
                </div>
                <h2 className="study-question">{card.question}</h2>
                <p className="study-answer">{card.answer}</p>
                <div className="study-card-foot"><span>{card.date}</span><span>Saved</span></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="study-empty">No cards match that search.</div>
        )}
      </section>
    </MockShell>
  );
}
