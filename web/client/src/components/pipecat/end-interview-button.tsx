"use client";

import { PhoneOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

// 和 connect-button.tsx 里「结束」动作同一套配色，两处观感保持一致。
export const END_CLASSES =
  "border-inactive/30 bg-inactive/10 text-inactive hover:bg-inactive/20 hover:text-inactive dark:bg-inactive/20";

/**
 * 「结束面试」按钮：主窗口的面试控件和悬浮窗共用它——
 * 两处动作一模一样，长相也得一模一样，只是所在窗口不同。
 */
export function EndInterviewButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      className={className ?? END_CLASSES}
      onClick={onClick}
    >
      <PhoneOffIcon />
      {t("connect.disconnect")}
    </Button>
  );
}
