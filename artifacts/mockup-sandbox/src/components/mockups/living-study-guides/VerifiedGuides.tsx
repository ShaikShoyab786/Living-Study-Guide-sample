import { ArrowUpRight, Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MockShell } from "./_shared/MockShell";
import "./_group.css";

const guideSessions = [
  { id: "guide-1", title: "The biology of memory", cards: 8, date: "Oct 27, 2026", topics: ["Spaced practice", "Working memory", "Recall"] },
  { id: "guide-2", title: "Cellular respiration · Lecture 04", cards: 12, date: "Oct 24, 2026", topics: ["Glycolysis", "ATP", "Mitochondria"] },
  { id: "guide-3", title: "Research methods · Seminar notes", cards: 6, date: "Oct 19, 2026", topics: ["Sampling", "Validity", "Study design"] },
];

export function VerifiedGuides() {
  const [query, setQuery] = useState("");
  const guides = useMemo(() => {
    const search = query.trim().toLowerCase();
    return guideSessions.filter((guide) =>
      !search || [guide.title, ...guide.topics].some((value) => value.toLowerCase().includes(search)),
    );
  }, [query]);

  return (
    <MockShell active="library" theme="light-preview">
      <section className="study-content">
        <div className="study-eyebrow">Verified library</div>
        <h1 className="study-title">Every idea,<br />kept in context.</h1>
        <p className="study-intro">
          Your approved cards stay connected to the note session and exact source lines that shaped them.
        </p>
        <div className="study-toolbar">
          <label className="study-search">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search guides or concepts…"
              aria-label="Search verified guides"
            />
          </label>
          <span className="study-count">{guides.length} {guides.length === 1 ? "guide" : "guides"}</span>
        </div>
        {guides.length ? (
          <div className="study-guide-list">
            {guides.map((guide, index) => (
              <article className="study-guide-row" key={guide.id}>
                <div className="study-guide-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <span className="study-concept">Note session · {guide.date}</span>
                  <h2 className="study-guide-title">{guide.title}</h2>
                  <span className="study-guide-meta">
                    <Check size={12} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />
                    {guide.cards} approved {guide.cards === 1 ? "card" : "cards"} · {guide.topics.join(" · ")}
                  </span>
                </div>
                <ArrowUpRight className="study-guide-arrow" size={21} aria-hidden="true" />
              </article>
            ))}
          </div>
        ) : (
          <div className="study-empty">No verified guides match that search.</div>
        )}
      </section>
    </MockShell>
  );
}
