"use client";

import { useRef, useState } from "react";
import { Alert, Button, Chip, Spinner, Tabs, TextArea, cn } from "@heroui/react";
import { ShieldCheck, Upload } from "lucide-react";
import { postJson, type IngestResponse, type PreviewResponse } from "./types";

const SAMPLE_PASTE = `用户：我最近在纠结要不要从大厂跳去一家 AI 创业公司，期权 0.3%，现金少 20 万。
助手：这取决于你对不确定性的承受力……
用户：我更想去创业公司，大厂做 AI 都是内耗。帮我分析一下 AI Agent 赛道两年内的机会。
用户：另外我想入门公路车，预算 8000，碳架和铝架差别大吗？`;

export function IngestStep({ onAnalyzed, initialTab = "upload" }: { onAnalyzed: (result: IngestResponse) => void; initialTab?: "upload" | "paste" }) {
  const [tab, setTab] = useState<string>(initialTab);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRaw, setFileRaw] = useState<unknown>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const rawFor = () => {
    switch (tab) {
      case "paste":
        return { raw: text, source: "paste" as const };
      case "upload":
        return { raw: fileRaw as Record<string, unknown>, source: "upload" as const };
      default:
        return { raw: text, source: "paste" as const };
    }
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await postJson<PreviewResponse>("/api/ingest", { ...rawFor(), previewOnly: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("analyze");
    setError(null);
    try {
      onAnalyzed(await postJson<IngestResponse>("/api/ingest", rawFor()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setFileName(file.name);
    try {
      setFileRaw(JSON.parse(content));
    } catch {
      setFileRaw(content);
    }
    setPreview(null);
  };

  const canSubmit = tab === "paste" ? text.trim().length > 20 : fileRaw !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">导入历史记录</h3>
        <p className="mt-1 text-sm text-muted">
          上传 ChatGPT 的 conversations.json 或 Claude 导出文件，一次导入全部历史。也可以粘贴一段文本先看看效果。
        </p>
      </div>

      <Tabs selectedKey={tab} onSelectionChange={(key) => { setTab(String(key)); setPreview(null); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="对话来源">
            <Tabs.Tab id="upload">上传导出文件<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="paste">粘贴一段试试<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="paste" className="pt-4">
          <TextArea
            value={text}
            onChange={(event) => { setText(event.target.value); setPreview(null); }}
            placeholder="粘贴你和 ChatGPT / Claude 的一段对话，或点右下角「填入示例」试试。"
            rows={9}
            fullWidth
            aria-label="要分析的 AI 对话" className="text-sm"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>支持「用户：」「User:」等前缀，或直接粘贴整段文字；JSON 导出也可以。</span>
            <Button variant="ghost" size="sm" onPress={() => setText(SAMPLE_PASTE)}>
              填入示例
            </Button>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="upload" className="pt-4">
          <input ref={fileInput} type="file" accept=".json,.txt,.md" className="hidden" onChange={(event) => onFile(event.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-sm text-muted transition-colors hover:bg-surface-secondary")}
          >
            <Upload className="size-5" />
            {fileName ? <span className="text-foreground">{fileName}</span> : <span>点击选择 ChatGPT conversations.json / Claude 导出 / 任意文本</span>}
          </button>
        </Tabs.Panel>
      </Tabs>

      {preview ? (
        <div className="rounded-xl border border-border bg-surface-secondary/50 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-success" />
            <span>
              解析出 {preview.conversationCount} 段对话、{preview.messageCount} 条消息；
            </span>
            {preview.redactions.length === 0 ? (
              <span className="text-muted">未发现需要脱敏的个人信息。</span>
            ) : (
              <>
                <span>进入模型前已隐去：</span>
                {preview.redactions.map((item) => (
                  <Chip key={item.category} size="sm" color="warning" variant="soft">
                    {item.label} ×{item.count}
                  </Chip>
                ))}
              </>
            )}
          </div>
          {preview.preview[0] ? (
            <div className="mt-3 space-y-1 text-xs text-muted">
              {preview.preview[0].messages.slice(0, 3).map((message, index) => (
                <p key={index} className="truncate">
                  <span className="font-medium">{message.role === "user" ? "用户" : "助手"}：</span>
                  {message.content}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>处理失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" isDisabled={!canSubmit || busy !== null} onPress={runPreview}>
          {busy === "preview" ? <Spinner size="sm" color="current" /> : <ShieldCheck className="size-4" />}
          预览脱敏结果
        </Button>
        <Button variant="primary" isDisabled={!canSubmit || busy !== null} onPress={analyze}>
          {busy === "analyze" ? <Spinner size="sm" color="current" /> : null}
          {busy === "analyze" ? "LLM 正在提取兴趣（约 20 秒）…" : "开始分析"}
        </Button>
      </div>
    </div>
  );
}
