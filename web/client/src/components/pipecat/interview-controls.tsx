"use client";

import { usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { Loader2Icon, PhoneOffIcon, RefreshCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

// 和 connect-button.tsx 里「结束」动作同一套配色，两处观感保持一致。
const END_CLASSES =
  "border-inactive/30 bg-inactive/10 text-inactive hover:bg-inactive/20 hover:text-inactive dark:bg-inactive/20";

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
}: {
  /** 还在取系统音频（系统选择框可能开着）。 */
  isPreparing: boolean;
  /** 已经发起过一次连接；用来区分「刚进来」和「失败/取消过」。 */
  attempted: boolean;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
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
  const ending = transportState === "disconnecting";

  if (connecting) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground hidden max-w-64 truncate text-xs md:inline">
          {/* 选框开着的时候给一句人话，否则用户不知道屏幕在等他什么。 */}
          {isPreparing
            ? t("connect.chooseScreen")
            : t("connect.preparing")}
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
        <Button size="sm" variant="outline" className={END_CLASSES} onClick={onDisconnect}>
          <PhoneOffIcon />
          {t("connect.disconnect")}
        </Button>
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
