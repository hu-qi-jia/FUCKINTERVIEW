"use client";

import type { ConversationMessage } from "@pipecat-ai/client-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { ConversationView } from "@/components/pipecat/conversation";
import { END_CLASSES } from "@/components/pipecat/interview-controls";
import { Button } from "@/components/ui/button";
import {
  requestAnswers,
  subscribeAnswers,
  type AnswerTurn,
} from "@/lib/answer-bus";
import { readTheme, resolveDark } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * 悬浮窗：面试中弹出的置顶小窗，只放回答，右上角两个动作。
 *
 * 它不参与面试本身——两条 Pipecat 会话都留在主窗口里跑，这里只收主窗口
 * 广播过来的回答（见 `lib/answer-bus`）。悬浮窗打开期间主窗口是隐藏的，
 * 但页面照跑，所以回答一直在更新。
 *
 * 窗口本身在主进程里是无边框透明的（`desktop/electron/main.js`），
 * 这里拿一张圆角卡片把内容包起来，圆角和阴影都由页面画。
 */
export function FloatWindow() {
  const { t, i18n } = useTranslation();
  const [turns, setTurns] = React.useState<AnswerTurn[]>([]);

  React.useEffect(() => {
    const unsubscribe = subscribeAnswers(setTurns);
    // 中途才开的窗：先问主窗口把已经攒下的回答要一份过来。
    requestAnswers();
    return unsubscribe;
  }, []);

  // 亮暗跟随主窗口：读的是同一份 localStorage，主窗口换了这里跟着换。
  // 顺手给 html 挂个标记，让页面别自己铺底色（见 index.css）。
  React.useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.classList.add("float-window");
    const apply = () => {
      document.documentElement.classList.toggle("dark", resolveDark(readTheme()));
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      document.documentElement.classList.remove("float-window");
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, [i18n.language]);

  const messages = React.useMemo<ConversationMessage[]>(
    () =>
      turns
        .filter((turn) => turn.text.trim())
        .map((turn) => ({
          role: "assistant" as const,
          final: turn.final,
          createdAt: turn.createdAt,
          parts: [
            {
              text: { spoken: turn.text, unspoken: "" },
              final: turn.final,
              createdAt: turn.createdAt,
              aggregatedBy: "sentence",
            },
          ],
        })),
    [turns],
  );

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div
        className={cn(
          "bg-card text-card-foreground ring-foreground/10",
          "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl ring-1",
          "shadow-[0_24px_60px_-18px_oklch(0_0_0/55%)]",
        )}
      >
        <header className="app-drag flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-sm font-medium">{t("conversation.answer")}</span>
          {/* 顶栏本身是拖拽区，两个按钮要从里面让出来。 */}
          <div className="app-no-drag ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.desktop?.float?.back()}
            >
              {t("float.back")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={END_CLASSES}
              onClick={() => window.desktop?.float?.end()}
            >
              {t("connect.disconnect")}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ConversationView
            showRole={false}
            messages={messages}
            empty={
              <div className="text-muted-foreground text-sm">
                {t("conversation.waitingAnswer")}
              </div>
            }
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
