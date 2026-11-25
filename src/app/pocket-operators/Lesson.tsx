import Link from "next/link";
import type { ReactNode } from "react";
import { sessionHref, sessionOrder, sessions, type Session } from "./sessions";
import styles from "./guide.module.css";

type LessonProps = {
  id: Session;
  children: ReactNode;
  reference: ReactNode;
  challenge: string;
  followUp?: { id: string; title: string; content: ReactNode };
  manual: { name: string; href: string };
};

export default function Lesson({ id, children, reference, challenge, manual, followUp }: LessonProps) {
  const session = sessions[id];
  const next = sessionOrder[sessionOrder.indexOf(id) + 1];

  return (
    <main>
      <header className={styles.intro}>
        <Link href="/pocket-operators" className={styles.back}>← All Pocket Operator sessions</Link>
        <h1>{session.title}</h1>
        <p className={styles.lead}>{session.description}</p>
        {followUp && <a className={styles.connectionJump} href={`#${followUp.id}`}>{followUp.title}</a>}
      </header>
      <section className={styles.lesson} aria-labelledby="exercise-title">
        <div>
          <h2 id="exercise-title">{session.focus}</h2>
          <ol className={styles.instructions}>{children}</ol>
          <p className={styles.source}><a href={manual.href}>{manual.name}</a></p>
        </div>
        <aside className={styles.reference} aria-label="Practice reference">{reference}</aside>
      </section>
      <section className={styles.checkpoint} aria-labelledby="challenge-title">
        <h2 id="challenge-title">Try it from memory</h2>
        <p>{challenge}</p>
      </section>
      {followUp?.content}
      <nav aria-label="Lesson navigation" className={styles.lessonLinks}>
        <Link href="/pocket-operators">All sessions</Link>
        {next ? <Link href={sessionHref(next)}>Next · {sessions[next].title} →</Link> : <Link href="/studio">Open studio →</Link>}
      </nav>
    </main>
  );
}
