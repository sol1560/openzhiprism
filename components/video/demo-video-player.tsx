"use client";

import { useId, useState } from "react";
import { DEMO_VIDEOS, streamEmbedUrl, type DemoLang } from "@/lib/video/demo";

export function DemoVideoPlayer() {
  const id = useId();
  const [lang, setLang] = useState<DemoLang>("zh");
  const video = DEMO_VIDEOS.find((item) => item.id === lang) ?? DEMO_VIDEOS[0];
  const count = DEMO_VIDEOS.length;
  return (
    <section className="video-player" aria-label="演示视频">
      <div className="video-toolbar">
        <div className="segmented-tabs" role="tablist" aria-label="视频语言" onKeyDown={(event) => {
          const index = DEMO_VIDEOS.findIndex((item) => item.id === lang);
          const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setLang(DEMO_VIDEOS[next].id);
          (event.currentTarget.querySelectorAll("button")[next] as HTMLButtonElement).focus();
        }}>
          {DEMO_VIDEOS.map((item) => <button type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-panel`} aria-selected={item.id === lang} tabIndex={item.id === lang ? 0 : -1} key={item.id} onClick={() => setLang(item.id)}>{item.label}</button>)}
        </div>
        <span className="video-caption">{video.title}</span>
      </div>
      <div className="video-frame" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${lang}`}>
        <iframe key={video.uid} src={streamEmbedUrl(video.uid)} title={video.title} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen />
      </div>
    </section>
  );
}
