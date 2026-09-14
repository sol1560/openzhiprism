"use client";

import { BarChart } from "@heroui-pro/react/bar-chart";
import type { InterestTopic } from "@/db/schema";

export function TopicWeightChart({ topics }: { topics: InterestTopic[] }) {
  const data = topics.slice(0, 8).map((topic) => ({
    name: topic.name.length > 8 ? `${topic.name.slice(0, 8)}…` : topic.name,
    权重: Math.round(topic.weight * 100),
    提及: topic.hits,
  }));
  if (data.length === 0) return <p className="text-sm text-muted">还没有足够的对话来画出权重，先接入一段对话。</p>;
  return (
    <BarChart data={data} height={Math.max(200, data.length * 36)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
      <BarChart.Grid horizontal={false} strokeDasharray="3 3" />
      <BarChart.XAxis type="number" domain={[0, 100]} hide />
      <BarChart.YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} />
      <BarChart.Tooltip cursor={false} content={<BarChart.TooltipContent indicator="dot" />} />
      <BarChart.Bar dataKey="权重" fill="var(--accent)" radius={6} />
    </BarChart>
  );
}
