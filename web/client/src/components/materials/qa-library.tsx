"use client";

import {
  CheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { QaEditor } from "@/components/materials/qa-editor";
import { QaImport } from "@/components/materials/qa-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  QA_TYPES,
  bulkDeleteQa,
  createQa,
  deleteQa,
  getQa,
  listQa,
  patchQa,
  qaFacets,
  qaStats,
  reindexQa,
  searchQa,
  type QaFacets,
  type QaItem,
  type QaPatch,
  type QaStats,
} from "@/lib/qa";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const ALL = "__all__";

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  const items = [{ value: ALL, label: allLabel }, ...options];
  return (
    <Select
      items={items}
      value={value || ALL}
      onValueChange={(next) => onChange(String(next) === ALL ? "" : String(next))}
    >
      <SelectTrigger className="h-8 w-auto min-w-24" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusDot({ status }: { status: QaItem["indexStatus"] }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        status === "ready"
          ? "bg-emerald-500"
          : status === "failed"
            ? "bg-destructive"
            : "bg-amber-500",
      )}
    />
  );
}

/**
 * 问答库：搜索（语义 + 关键词）、筛选、批量删除、行内编辑与导入。
 * 搜索框为空时走列表分页，有内容时走检索接口并按相关度排序。
 */
export function QaLibrary({ dataVersion = 0 }: { dataVersion?: number }) {
  const { t } = useTranslation();

  const [view, setView] = useState<"list" | "import">("list");
  const [items, setItems] = useState<QaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");

  const [facets, setFacets] = useState<QaFacets>({ categories: [], tags: [] });
  const [stats, setStats] = useState<QaStats | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const reload = useCallback(
    async (offset = 0) => {
      const ticket = ++requestId.current;
      if (offset === 0) setLoading(true);
      setError(null);
      try {
        if (query) {
          const results = await searchQa(query, {
            limit: PAGE_SIZE,
            types: type ? [type] : undefined,
            categories: category ? [category] : undefined,
            tags: tag ? [tag] : undefined,
          });
          if (ticket !== requestId.current) return;
          setItems(results);
          setTotal(results.length);
        } else {
          const data = await listQa({
            category,
            type,
            tag,
            limit: PAGE_SIZE,
            offset,
          });
          if (ticket !== requestId.current) return;
          setItems((current) => (offset === 0 ? data.items : [...current, ...data.items]));
          setTotal(data.total);
        }
      } catch (caught) {
        if (ticket !== requestId.current) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (ticket === requestId.current) setLoading(false);
      }
    },
    [query, type, category, tag],
  );

  const refreshMeta = useCallback(async () => {
    try {
      const [nextFacets, nextStats] = await Promise.all([qaFacets(), qaStats()]);
      setFacets(nextFacets);
      setStats(nextStats);
    } catch {
      // 元信息失败不影响列表本身。
    }
  }, []);

  useEffect(() => {
    void reload(0);
  }, [reload, dataVersion]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta, dataVersion]);

  // 打开页面时把上次中断的索引补上；之后按需轮询进度。
  useEffect(() => {
    void (async () => {
      try {
        const current = await qaStats();
        setStats(current);
        if (current.pending > 0 || current.failed > 0) {
          await reindexQa("stale");
        }
      } catch {
        // 模型不可用时也不该挡住浏览。
      }
    })();
  }, [dataVersion]);

  const indexing = (stats?.pending ?? 0) + (stats?.indexing ?? 0) + (stats?.queue ?? 0);
  useEffect(() => {
    if (indexing <= 0) return;
    const timer = window.setInterval(() => {
      void qaStats().then(setStats).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [indexing]);

  const selectedCount = selected.size;
  const hasMore = !query && items.length < total;

  const save = useCallback(
    async (id: number, patch: QaPatch) => {
      setSavingId(id);
      setSaveError(null);
      try {
        const updated = await patchQa(id, patch);
        setItems((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...updated,
                  score: item.score,
                  matchedText: item.matchedText,
                  matchedBy: item.matchedBy,
                }
              : item,
          ),
        );
        void refreshMeta();
        // 后台索引很快，稍后把这一条的索引状态取回来，避免一直显示「待索引」。
        window.setTimeout(() => {
          void getQa(id)
            .then((fresh) => {
              setItems((current) =>
                current.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        indexStatus: fresh.indexStatus,
                        indexError: fresh.indexError,
                        updatedAt: fresh.updatedAt,
                      }
                    : item,
                ),
              );
            })
            .catch(() => undefined);
        }, 1200);
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSavingId(null);
      }
    },
    [refreshMeta],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await deleteQa(id);
        setItems((current) => current.filter((item) => item.id !== id));
        setTotal((value) => Math.max(0, value - 1));
        setExpandedId((current) => (current === id ? null : current));
        void refreshMeta();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [refreshMeta],
  );

  const removeSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await bulkDeleteQa([...selected]);
      setSelected(new Set());
      setSelecting(false);
      await reload(0);
      void refreshMeta();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [selected, reload, refreshMeta]);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      const created = await createQa({
        question: t("qa.newQuestion"),
        answer: t("qa.newAnswer"),
        type: "general",
        proficiency: 3,
      });
      setItems((current) => [created, ...current]);
      setTotal((value) => value + 1);
      setExpandedId(created.id);
      setQuery("");
      setSearchText("");
      void refreshMeta();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [refreshMeta, t]);

  const toggleSelected = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filterSummary = useMemo(() => {
    if (!stats) return "";
    return t("qa.summary", {
      total: stats.total,
      indexed: stats.ready,
    });
  }, [stats, t]);

  if (view === "import") {
    return (
      <QaImport
        onBack={() => setView("list")}
        onDone={() => {
          void reload(0);
          void refreshMeta();
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 pt-3">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4">
          <div className="relative min-w-40 flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t("qa.searchPlaceholder")}
              className="h-8 pl-8"
            />
            {searchText && (
              <button
                type="button"
                aria-label={t("qa.clearSearch")}
                onClick={() => setSearchText("")}
                className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          <FilterSelect
            value={type}
            onChange={setType}
            allLabel={t("qa.filters.allTypes")}
            label={t("qa.field.type")}
            options={QA_TYPES.map((value) => ({ value, label: t(`qa.type.${value}`) }))}
          />
          {facets.categories.length > 0 && (
            <FilterSelect
              value={category}
              onChange={setCategory}
              allLabel={t("qa.filters.allCategories")}
              label={t("qa.field.category")}
              options={facets.categories.map((value) => ({ value, label: value }))}
            />
          )}
          {facets.tags.length > 0 && (
            <FilterSelect
              value={tag}
              onChange={setTag}
              allLabel={t("qa.filters.allTags")}
              label={t("qa.field.tags")}
              options={facets.tags.map((value) => ({ value, label: value }))}
            />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setView("import")} disabled={busy}>
              <UploadIcon />
              {t("qa.import.open")}
            </Button>
            <Button size="sm" onClick={() => void create()} disabled={busy}>
              <PlusIcon />
              {t("qa.new")}
            </Button>
          </div>
        </div>

        <div className="text-muted-foreground mx-auto mt-2 flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 text-xs">
          <span>{filterSummary}</span>
          {indexing > 0 && (
            <span className="flex items-center gap-1">
              <Spinner className="size-3" />
              {t("qa.indexing", { count: indexing })}
            </span>
          )}
          {(stats?.failed ?? 0) > 0 && (
            <button
              type="button"
              className="text-destructive hover:underline"
              onClick={() => {
                void reindexQa("failed");
                void refreshMeta();
              }}
            >
              {t("qa.failedRetry", { count: stats?.failed ?? 0 })}
            </button>
          )}
          {(stats?.failed ?? 0) === 0 && indexing > 0 && (
            <button
              type="button"
              className="hover:underline"
              aria-label={t("qa.refresh")}
              onClick={() => void refreshMeta()}
            >
              <RefreshCwIcon className="inline size-3" />
            </button>
          )}
          <button
            type="button"
            className="ml-auto hover:underline"
            onClick={() => {
              setSelecting((current) => !current);
              setSelected(new Set());
            }}
          >
            {selecting ? t("qa.select.cancel") : t("qa.select.start")}
          </button>
        </div>
      </div>

      {selecting && (
        <div className="bg-muted/40 mt-2 flex shrink-0 items-center gap-2 border-y px-4 py-1.5 text-xs">
          <span className="flex-1">
            {t("qa.select.count", { count: selectedCount })}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={items.length === 0}
            onClick={() => setSelected(new Set(items.map((item) => item.id)))}
          >
            {t("qa.select.all")}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            disabled={selectedCount === 0 || busy}
            onClick={() => void removeSelected()}
          >
            {t("qa.select.delete")}
          </Button>
        </div>
      )}

      {error && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">{error}</div>
      )}
      {saveError && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">{saveError}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          {loading && items.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Spinner />
              {t("qa.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-sm font-medium">
                {query || type || category || tag ? t("qa.emptyFiltered") : t("qa.empty.title")}
              </p>
              {!(query || type || category || tag) && (
                <p className="text-muted-foreground max-w-sm text-xs">{t("qa.empty.hint")}</p>
              )}
            </div>
          ) : (
            <ul className="grid gap-2">
              {items.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1 transition-colors",
                      expanded && "ring-primary/30",
                    )}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (selecting) {
                          toggleSelected(item.id);
                        } else {
                          setExpandedId(expanded ? null : item.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (selecting) toggleSelected(item.id);
                          else setExpandedId(expanded ? null : item.id);
                        }
                      }}
                      className="hover:bg-muted/40 flex cursor-pointer items-start gap-2.5 p-3"
                    >
                      {selecting && (
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                            selected.has(item.id)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border",
                          )}
                        >
                          {selected.has(item.id) && <CheckIcon className="size-3" />}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusDot status={item.indexStatus} />
                          <span className="truncate text-sm font-medium">{item.question}</span>
                          {item.score !== undefined && (
                            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                              {Math.round((item.score ?? 0) * 100)}%
                            </span>
                          )}
                          {!item.enabled && (
                            <span className="text-muted-foreground shrink-0 text-[10px]">
                              {t("qa.disabled")}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                          {item.answer}
                        </p>
                        {(item.aliases.length > 0 ||
                          item.tags.length > 0 ||
                          item.category ||
                          item.type !== "general") && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="bg-muted/60 rounded px-1.5 py-0.5 text-[10px]">
                              {t(`qa.type.${item.type}`)}
                            </span>
                            {item.category && (
                              <span className="bg-muted/60 rounded px-1.5 py-0.5 text-[10px]">
                                {item.category}
                              </span>
                            )}
                            {item.tags.map((name) => (
                              <span
                                key={name}
                                className="text-muted-foreground rounded px-1 py-0.5 text-[10px] ring-1 ring-current/15"
                              >
                                {name}
                              </span>
                            ))}
                            {item.aliases.length > 0 && (
                              <span className="text-muted-foreground/70 text-[10px]">
                                {t("qa.aliasCount", { count: item.aliases.length })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                        {"★".repeat(item.proficiency)}
                      </span>
                    </div>

                    {expanded && (
                      <QaEditor
                        item={item}
                        saving={savingId === item.id}
                        saveFailed={savingId === item.id ? null : saveError}
                        onSave={(patch) => save(item.id, patch)}
                        onDelete={() => void remove(item.id)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div className="flex justify-center py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void reload(items.length)}
              >
                {loading ? <Spinner className="size-3" /> : null}
                {t("qa.loadMore", { remaining: total - items.length })}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
