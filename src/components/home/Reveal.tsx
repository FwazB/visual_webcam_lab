"use client";

// Marks a list for its one-time scroll entrance. Hiding only starts once this
// runs (data-armed), so the list stays visible without JavaScript.

import { useEffect, useRef, type ReactNode } from "react";

export default function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    list.dataset.armed = "";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        list.dataset.visible = "";
        observer.disconnect();
      },
      { rootMargin: "0px 0px -100px 0px" },
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return (
    <ul ref={ref} className={className}>
      {children}
    </ul>
  );
}
