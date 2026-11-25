"use client";

import Link from "next/link";
import { useRef } from "react";
import { useTiltStep } from "@/hooks/useTiltStep";
import { sessionHref, sessionOrder, sessions } from "./sessions";
import styles from "./guide.module.css";

export default function LessonDirectory() {
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  useTiltStep((direction) => {
    const current = links.current.findIndex((link) => link === document.activeElement);
    const count = sessionOrder.length;
    const next = current < 0 ? (direction > 0 ? 0 : count - 1) : (current + direction + count) % count;
    links.current[next]?.focus();
  });

  return (
    <nav className={styles.directory} aria-label="Practice sessions">
      <ol>
        {sessionOrder.map((id, index) => (
          <li key={id} id={id}>
            <Link href={sessionHref(id)} ref={(link) => { links.current[index] = link; }}>
              <strong>{sessions[id].title}</strong>
              <span>{sessions[id].focus}</span>
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
