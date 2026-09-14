"use client";

import { useEffect, useRef, useState } from "react";

export function AmbientLight({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`ambient-light ${className}`} data-running={running} aria-hidden="true">
    <div className="ambient-blue" /><div className="ambient-gold" /><div className="ambient-ray" />
  </div>;
}
