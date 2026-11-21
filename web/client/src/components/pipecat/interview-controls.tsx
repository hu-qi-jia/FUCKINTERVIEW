"use client";

import { usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { AppWindowIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { EndInterviewButton } from "@/components/pipecat/end-interview-button";
import { Button } from "@/components/ui/button";

/**
 * 面试页的连接控件。
 *
 * 和通用的 ConnectButton 的区别在于：面试页的连接是**进页面就自动发起**的
 * （系统音频选择框必须留在那一次点击的手势窗口里，不能推迟也不能提前），
 * 所以这里不给「连接」按钮——只有连上之后的「结束面试」。
 *
 * 连接过程中给的是一个**独立的「取消」按钮**，不和「结束面试」共用那个变形
 * 按钮，而且连上之后就消失：连接过程中的操作和面试中的操作要一眼分得开。
 */
export function InterviewControls({
  isPreparing,
  attempted,
  onConnect,
  onCancel,
  onDisconnect,
  onOpenFloat,
}: {
  /** 还在取系统音频（系统选择框可能开着）。 */
  isPreparing: boolean;
  /** 已经发起过一次连接；用来区分「刚进来」和「失败/取消过」。 */
  attempted: boolean;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  /** 弹出悬浮窗。桌面端才给；不给就不显示这个按钮。 */
  onOpenFloat?: () => void;
}) {
  const { t } = useTranslation();
  const transportState = usePipecatClientTransportState();

  const connected =
    transportState === "connected" || transportState === "ready";
  const connecting =
    isPreparing ||
    transportState === "initializing" ||
    transportState === "authenticating" ||
    transportState === "authenticated" ||
    transportState === "connecting";
  // 连上过就记一笔：这一场只要真的连上过，之后无论怎么掉（点结束、
  // 外部停止共享、网络断）都算结束，别再闪一下「重试」——页面马上回首页，
  // 「重试」只留给压根没连上的失败。
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    if (connected) setLinked(true);
  }, [connected]);
  const ending = transportState === "disconnecting" || linked;

  if (connecting) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground hidden max-w-64 truncate text-xs md:inline">
          {t("connect.preparing")}
        </span>
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("connect.cancel")}
        </Button>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        {/* 连上之后 bot 可能还在起；按钮先出现，识别好了再开始答题。 */}
        {transportState === "connected" && (
          <span className="text-muted-foreground hidden text-xs md:inline">
            {t("connect.starting")}
          </span>
        )}
        {/* 悬浮窗：把回答拎到置顶小窗里，主窗口同时收起来。排在「结束面试」左边。 */}
        {onOpenFloat && (
          <Button size="sm" variant="outline" onClick={onOpenFloat}>
            <AppWindowIcon />
            {t("float.open")}
          </Button>
        )}
        <EndInterviewButton onClick={onDisconnect} />
      </div>
    );
  }

  if (ending) {
    return (
      <Button size="sm" variant="outline" disabled>
        <Loader2Icon className="animate-spin" />
        {t("connect.disconnecting")}
      </Button>
    );
  }

  // 连上过又断开、或者压根没发起成功：给「重试」。
  // 没发起过（刚进页面、自动连接还没跑起来）什么都不显示，免得闪一下。
  if (!attempted) return null;

  return (
    <Button size="sm" variant="destructive" onClick={onConnect}>
      <RefreshCwIcon />
      {t("connect.retry")}
    </Button>
  );
}
