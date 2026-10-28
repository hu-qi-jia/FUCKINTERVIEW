"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProfiles, type ProfileSummary } from "@/lib/materials";
import { cn } from "@/lib/utils";

/**
 * 实时面试要绑定的面试档案。选择保存在浏览器本地，连接时随 /start 下发给后端；
 * 没有档案时只显示一句提示。
 */
export function LiveProfileSelect({
  value,
  onChange,
  dataVersion = 0,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  dataVersion?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    listProfiles()
      .then((next) => {
        if (cancelled) return;
        setProfiles(next);
        const current = valueRef.current;
        if (!next.some((item) => item.id === current)) {
          onChangeRef.current(next[0]?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  if (profiles && profiles.length === 0) {
    return (
      <span className={cn("text-muted-foreground text-xs", className)}>
        {t("materials.liveProfile.empty")}
      </span>
    );
  }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5", className)}
      title={t("materials.liveProfile.hint")}
    >
      <span className="text-muted-foreground hidden text-xs lg:inline">
        {t("materials.liveProfile.label")}
      </span>
      <Select
        items={(profiles ?? []).map((item) => ({
          value: item.id,
          label: item.name || t("materials.untitled"),
        }))}
        value={value ?? null}
        onValueChange={(id) => onChange(String(id))}
        disabled={!profiles}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-36"
          aria-label={t("materials.liveProfile.label")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {(profiles ?? []).map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name || t("materials.untitled")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
