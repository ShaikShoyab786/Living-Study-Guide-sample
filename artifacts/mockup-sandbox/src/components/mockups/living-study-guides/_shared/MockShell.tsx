import { BookOpenCheck, FileText, Library, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

type MockShellProps = {
  active: "library" | "review";
  children: ReactNode;
  selectedSession?: string;
  theme?: "light-preview" | "dark-preview";
};

export function MockShell({
  active,
  children,
  selectedSession,
  theme = "light-preview",
}: MockShellProps) {
  return (
    <div className={`study-mockup ${theme}`}>
      <aside className="study-sidebar">
        <div className="study-brand">
          <span className="study-brand-mark">
            <BookOpenCheck size={19} strokeWidth={1.8} />
          </span>
          <span>
            <span className="study-brand-title">Living Study</span>
            <span className="study-brand-subtitle">Make knowledge stay.</span>
          </span>
        </div>
        <div className="study-nav-caption">Your study space</div>
        <nav className="study-nav-list" aria-label="Main navigation">
          <div className="study-nav-item"><PanelLeft size={15} />Workspace</div>
          <div className={`study-nav-item ${active === "review" ? "active" : ""}`}>
            <BookOpenCheck size={15} />Review Hub
          </div>
          <div className={`study-nav-item ${active === "library" ? "active" : ""}`}>
            <Library size={15} />Verified Library
          </div>
        </nav>
        <div className="study-session-heading">Note sessions</div>
        <div className="study-session-item">
          <FileText size={14} />
          <span>Cellular respiration · Lecture 04</span>
        </div>
        <div className={`study-session-item ${selectedSession ? "active" : ""}`}>
          <FileText size={14} />
          <span>{selectedSession || "The biology of memory"}</span>
        </div>
        <div className="study-sidebar-footer">A PERSONAL STUDY SPACE</div>
      </aside>
      <main className="study-main">
        <header className="study-topbar">
          <div className="study-crumb">Study desk <span aria-hidden="true">/</span> {active === "library" ? "Verified library" : "Review hub"}</div>
          <div className="study-status"><span className="study-status-dot" />Study space ready</div>
        </header>
        {children}
      </main>
    </div>
  );
}
