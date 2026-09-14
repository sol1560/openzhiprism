"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { Stepper } from "@heroui-pro/react";
import { Check } from "lucide-react";
import type { InterestTopic } from "@/db/schema";
import { ConnectStep } from "./connect-step";
import { ResultStep, type ResultStats } from "./result-step";
import type { IngestResponse } from "./types";

const STEPS = [
  { title: "连接 AI", description: "或导入历史" },
  { title: "兴趣画像", description: "生成 Feed" },
];

const OAUTH_MESSAGES: Record<string, string> = {
  unavailable: "知乎登录尚未配置，可以先用邮箱登录后连接 AI。",
  invalid_state: "知乎授权已过期或无法验证，请重新登录。",
  denied: "已取消知乎授权。",
  failed: "暂时无法完成知乎登录，请稍后重试或改用邮箱登录。",
};

export function OnboardingFlow({
  initialStep,
  topics,
  stats,
  oauth,
  connect,
}: {
  initialStep: 0 | 1;
  topics: InterestTopic[];
  stats: ResultStats;
  oauth: string | null;
  connect: { endpoint: string; cursorUrl: string; localOnly: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 步骤由 URL 驱动：?step=2 是第 2 步，刷新不会丢；服务端已校验有画像才允许进第 2 步
  const step: 0 | 1 = searchParams.get("step") === "2" && (topics.length > 0 || initialStep === 1) ? 1 : 0;
  const [ingest, setIngest] = useState<IngestResponse | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(oauth ? OAUTH_MESSAGES[oauth] ?? "知乎登录失败，请重试。" : null);

  // 分析成功后把 URL 推进到第 2 步；服务端组件随之用最新画像重新渲染
  useEffect(() => {
    if (ingest && step === 0) router.replace("/onboarding?step=2");
  }, [ingest, step, router]);

  const resultTopics = ingest?.topics ?? topics;
  const resultStats: ResultStats = ingest
    ? { conversationCount: ingest.conversationCount, messageCount: ingest.messageCount, redactedCount: ingest.redactions.reduce((sum, item) => sum + item.count, 0) }
    : stats;

  return (
    <div className="onboarding-inner">
      {oauthError ? (
        <Alert status="warning" className="mb-6">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{oauthError}</Alert.Title>
          </Alert.Content>
          <Button size="sm" variant="ghost" className="self-center" onPress={() => setOauthError(null)}>知道了</Button>
        </Alert>
      ) : null}

      <Stepper currentStep={step} className="mb-10">
        {STEPS.map((item, index) => (
          <Stepper.Step key={item.title}>
            <Stepper.Indicator>{index < step ? <Check className="size-4" /> : index + 1}</Stepper.Indicator>
            <Stepper.Content>
              <Stepper.Title>{item.title}</Stepper.Title>
              <Stepper.Description>{item.description}</Stepper.Description>
            </Stepper.Content>
            <Stepper.Separator />
          </Stepper.Step>
        ))}
      </Stepper>

      <div className="onboarding-card">
        {step === 0 && !ingest ? <ConnectStep endpoint={connect.endpoint} cursorUrl={connect.cursorUrl} localOnly={connect.localOnly} onAnalyzed={setIngest} /> : null}
        {step === 1 || ingest ? (
          <ResultStep
            topics={resultTopics}
            newTopicNames={ingest?.newTopicNames ?? []}
            stats={resultStats}
            redactions={ingest?.redactions}
            redactedCategoriesFromLlm={ingest?.redactedCategoriesFromLlm}
            llm={ingest?.llm}
            feedBuild={ingest?.feedBuild ?? null}
          />
        ) : null}
      </div>
    </div>
  );
}
