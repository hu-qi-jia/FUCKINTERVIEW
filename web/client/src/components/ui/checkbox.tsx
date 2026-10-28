"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";

/**
 * 全站统一的多选框（base-ui Checkbox）：16px 方框、主色选中态、
 * 键盘可聚焦。label 由调用方用 aria-label 或外层 <label> 提供。
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-transparent text-primary-foreground transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-checked:border-primary data-checked:bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-input/30 dark:data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex data-unchecked:hidden"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
