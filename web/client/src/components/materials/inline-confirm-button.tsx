"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * 二次确认按钮：第一次点击变成确认文案，3 秒内再点才真正执行。
 * 用在删除档案、重新生成这类不能撤销的操作上，避免另开弹窗。
 */
export function InlineConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "onClick"> & {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Button
      {...props}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        if (timer.current !== null) window.clearTimeout(timer.current);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
