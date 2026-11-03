"use client";

import logo from "@/assets/logo.png";
import { cn } from "@/lib/utils";

/**
 * 产品图标（鸟头）。方形、透明底，深浅主题通用。
 * 尺寸用 size 控制，锁定宽高比，不随父级拉伸。
 */
export function BrandLogo({
  alt = "面试语音助手",
  size = 24,
  className,
}: {
  alt?: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={logo}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
