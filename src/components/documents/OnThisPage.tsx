"use client";

import { useEffect, useRef, useState } from "react";

import type { HeadingItem } from "@/lib/content/headings";
import { cn } from "@/lib/utils";

function findScrollContainer(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

export function OnThisPage({ items, className }: { items: HeadingItem[]; className?: string }) {
  const asideRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // True while a TOC click's smooth scroll is in flight — the spy must not
  // override the item the user just clicked.
  const suppressRef = useRef(false);

  const minLevel = Math.min(...items.map((i) => i.level));

  // Locate the scroll container (the app shell's <main>) and keep the active
  // heading in sync with the scroll position.
  useEffect(() => {
    const container = findScrollContainer(asideRef.current);
    containerRef.current = container;

    const updateActive = () => {
      const c = containerRef.current;
      if (!c || suppressRef.current) return;
      const containerTop =
        c instanceof HTMLElement ? c.getBoundingClientRect().top : 0;
      const threshold = containerTop + 96; // keep the heading clear of the top edge
      let current: string | null = null;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= threshold) current = item.id;
      }
      // Scrolled to the bottom: the final headings can't always reach the
      // threshold (short trailing content), so honor the last heading —
      // otherwise the last sections can never become active.
      const atBottom =
        c instanceof HTMLElement
          ? c.scrollTop + c.clientHeight >= c.scrollHeight - 1
          : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && items.length > 0) current = items[items.length - 1].id;
      setActiveId(current ?? items[0]?.id ?? null);
    };

    // Headings are stamped with ids by DocumentViewer after the editor mounts —
    // poll briefly until they exist, then start tracking.
    let tries = 0;
    const waitForHeadings = () => {
      if (document.getElementById(items[0]?.id ?? "") || tries > 60) {
        updateActive();
        container.addEventListener("scroll", updateActive, { passive: true });
        window.addEventListener("resize", updateActive);
      } else {
        tries += 1;
        requestAnimationFrame(waitForHeadings);
      }
    };
    waitForHeadings();

    return () => {
      container.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [items]);

  function scrollToHeading(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    suppressRef.current = true;
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Re-enable the spy once the programmatic scroll settles (scrollend fires
    // when it finishes; timeout as a fallback). Until then the clicked item
    // stays highlighted.
    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      suppressRef.current = false;
      const c = containerRef.current;
      if (c instanceof HTMLElement) c.removeEventListener("scrollend", clear);
      else window.removeEventListener("scrollend", clear);
    };
    const c = containerRef.current;
    if (c instanceof HTMLElement) c.addEventListener("scrollend", clear);
    else window.addEventListener("scrollend", clear);
    setTimeout(clear, 800);
  }

  return (
    <aside ref={asideRef} className={cn("pt-6", className)}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On This Page</p>
      <nav className="mt-3" aria-label="On this page">
        <ul className="space-y-1 border-l border-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => scrollToHeading(item.id)}
                style={{ paddingLeft: 12 + (item.level - minLevel) * 12 }}
                className={cn(
                  "-ml-px block w-full border-l py-1 pr-2 text-left text-[13px] leading-snug transition-colors",
                  activeId === item.id
                    ? "border-gp-green font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
