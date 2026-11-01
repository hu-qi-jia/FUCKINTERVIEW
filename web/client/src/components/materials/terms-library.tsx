"use client";

import { PuzzleIcon, SearchIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";

import { InlineConfirmButton } from "@/components/materials/inline-confirm-button";
import { TermsBulkDialog } from "@/components/materials/terms-bulk-dialog";
import { TermsFormDialog } from "@/components/materials/terms-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  clearRecent,
  createTemplate,
  createTerm,
  deleteTemplate,
  deleteTerm,
  listTemplates,
  listTerms,
  recentTerms,
  resetTemplate,
  termStats,
  toggleTemplate,
  updateTerm,
  type TemplateItem,
  type TermItem,
  type TermPatch,
  type TermRecent,
  type TermStats,
} from "@/lib/terms";
import { cn } from "@/lib/utils";

const ALL = "__all__";

// 表头与每一行都是同一个 grid 的子网格，列宽才会真正对齐（各算各的会错位）。
const GRID_COLS =
  "grid-cols-[minmax(0,1.7fr)_minmax(0,1.6fr)_auto_auto] sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto_auto]";
const SUBGRID_ROW = "col-span-full grid grid-cols-subgrid items-center gap-3 px-3";

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
      <SelectTrigger className="h-8 w-32" aria-label={label}>
        <SelectValue className="min-w-0 truncate" />
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

export interface TermsLibraryHandle {
  create: () => void;
  openBulk: () => void;
}

/**
 * 术语库：一行一个词条，术语 / 替换词 / 释义并排展示，末尾放编辑与删除。
 * 新建和编辑都走弹窗，列表本身只做浏览与开关。
 *
 * 内置模板按插件对待：放在「模板」浮层里按需开关，不开的模板连词条都不出现在表里，
 * 也不参与纠错和提示词注入。自定义词条排在前面，同一个词以自定义为准。
 */
export function TermsLibrary({
  ref,
  dataVersion = 0,
}: {
  ref?: Ref<TermsLibraryHandle>;
  dataVersion?: number;
}) {
  const { t } = useTranslation();

  const [items, setItems] = useState<TermItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [stats, setStats] = useState<TermStats | null>(null);
  const [recent, setRecent] = useState<TermRecent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState("");

  const [editing, setEditing] = useState<TermItem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState("");

  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const reload = useCallback(async () => {
    const ticket = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [list, catalog, meta] = await Promise.all([
        listTerms({ q: query, template }),
        listTemplates(),
        termStats(),
      ]);
      if (ticket !== requestId.current) return;
      setItems(list.items);
      setTemplates(catalog);
      setStats(meta);
    } catch (caught) {
      if (ticket !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, [query, template]);

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  useEffect(() => {
    void recentTerms()
      .then(setRecent)
      .catch(() => undefined);
  }, [dataVersion]);

  const save = useCallback(async (id: number, patch: TermPatch) => {
    setSaveError(null);
    try {
      const updated = await updateTerm(id, patch);
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const remove = useCallback(async (id: number) => {
    try {
      await deleteTerm(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const submitCreate = useCallback(
    async (fields: TermPatch) => {
      await createTerm(fields);
      setCreateOpen(false);
      // 建完回到未筛选的列表，新词条按「自定义优先」排在最前面。
      setSearchText("");
      setQuery("");
      setTemplate("");
      await reload();
    },
    [reload],
  );

  const submitEdit = useCallback(
    async (fields: TermPatch) => {
      if (!editing) return;
      await updateTerm(editing.id, fields);
      setEditing(null);
      await reload();
    },
    [editing, reload],
  );

  const switchTemplate = useCallback(
    async (id: string, enabled: boolean) => {
      setTemplates((current) =>
        current.map((item) => (item.id === id ? { ...item, enabled } : item)),
      );
      try {
        await toggleTemplate(id, enabled);
        await reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await reload();
      }
    },
    [reload],
  );

  const restoreTemplate = useCallback(
    async (id: string) => {
      try {
        await resetTemplate(id);
        await reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [reload],
  );

  const templateLabel = useCallback(
    (entry: TemplateItem) =>
      entry.builtin ? t(`terms.template.${entry.id}`) : entry.name,
    [t],
  );

  const rowBadge = useCallback(
    (item: TermItem) => {
      const entry = templates.find((tpl) => tpl.id === item.template);
      if (!entry) return "";
      return entry.builtin ? t(`terms.templateShort.${entry.id}`) : entry.name;
    },
    [templates, t],
  );

  const addTemplate = useCallback(async () => {
    const name = newTemplate.trim();
    if (!name) return;
    try {
      await createTemplate(name);
      setNewTemplate("");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [newTemplate, reload]);

  const removeTemplate = useCallback(
    async (id: string) => {
      try {
        await deleteTemplate(id);
        setTemplate((current) => (current === id ? "" : current));
        await reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [reload],
  );

  const addSuggestion = useCallback(
    async (from: string, to: string) => {
      const target = items.find((item) => item.term === to);
      if (!target) return;
      if (target.aliases.some((alias) => alias.toLowerCase() === from.toLowerCase())) {
        return;
      }
      await save(target.id, { aliases: [...target.aliases, from] });
      setRecent((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.filter((item) => item.from !== from),
            }
          : current,
      );
    },
    [items, save],
  );

  const dismissRecent = useCallback(async () => {
    setRecent(null);
    await clearRecent().catch(() => undefined);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      create: () => setCreateOpen(true),
      openBulk: () => setBulkOpen(true),
    }),
    [],
  );

  // 关掉的模板整列不出现；自定义词条永远在。
  const visibleItems = useMemo(() => {
    const enabled = new Map(templates.map((item) => [item.id, item.enabled]));
    return items.filter(
      (item) => item.template === "custom" || enabled.get(item.template) !== false,
    );
  }, [items, templates]);

  const hasRecent =
    recent && (recent.corrections.length > 0 || recent.suggestions.length > 0);

  const filterActive = Boolean(query || template);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 pt-3">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4">
          <div className="relative min-w-40 flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t("terms.searchPlaceholder")}
              className="h-8 pl-8"
            />
            {searchText && (
              <button
                type="button"
                aria-label={t("terms.clearSearch")}
                onClick={() => setSearchText("")}
                className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          <FilterSelect
            value={template}
            onChange={setTemplate}
            allLabel={t("terms.filters.all")}
            label={t("terms.field.template")}
            options={templates.map((entry) => ({
              value: entry.id,
              label: templateLabel(entry),
            }))}
          />

          {/* 模板按插件处理：不开的那套连词条都不出现，随时可以插拔。 */}
          <Popover>
            <PopoverTrigger
              render={<Button size="sm" variant="outline" className="h-8" />}
            >
              <PuzzleIcon />
              {t("terms.templates.button")}
              <span className="text-muted-foreground text-[11px] tabular-nums">
                {templates.filter((entry) => entry.enabled).length}/{templates.length}
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
                {t("terms.templates.hint")}
              </p>
              {templates.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 px-1 py-1">
                  <Switch
                    size="sm"
                    checked={entry.enabled}
                    onCheckedChange={(next) =>
                      void switchTemplate(entry.id, Boolean(next))
                    }
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      !entry.enabled && "text-muted-foreground",
                    )}
                    title={templateLabel(entry)}
                  >
                    {templateLabel(entry)}
                  </span>
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {entry.count}
                  </span>
                  {entry.builtin && entry.id !== "custom" ? (
                    <InlineConfirmButton
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground/60 hover:text-foreground h-5 px-1 text-[11px]"
                      label={t("terms.template.reset")}
                      confirmLabel={t("terms.template.resetConfirm")}
                      onConfirm={() => void restoreTemplate(entry.id)}
                    />
                  ) : !entry.builtin ? (
                    <InlineConfirmButton
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground/60 hover:text-destructive h-5 px-1 text-[11px]"
                      label={t("terms.templates.delete")}
                      confirmLabel={t("terms.templates.deleteConfirm")}
                      onConfirm={() => void removeTemplate(entry.id)}
                    />
                  ) : null}
                </div>
              ))}

              <div className="border-border mt-1 flex items-center gap-1.5 border-t pt-2">
                <Input
                  value={newTemplate}
                  onChange={(event) => setNewTemplate(event.target.value)}
                  placeholder={t("terms.templates.namePlaceholder")}
                  className="h-7 flex-1 text-xs"
                  maxLength={24}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      void addTemplate();
                    }
                  }}
                />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!newTemplate.trim()}
                  onClick={() => void addTemplate()}
                >
                  {t("terms.templates.add")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {hasRecent && (
        <div className="mx-auto w-full max-w-7xl shrink-0 px-4 pt-3">
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs">
            <span className="font-medium">{t("terms.recent.title")}</span>
            {recent.corrections.map((item) => (
              <span
                key={`c-${item.from}`}
                className="bg-background rounded-full px-2 py-0.5 text-[11px]"
              >
                {item.from} → {item.to}
              </span>
            ))}
            {recent.suggestions.map((item) => (
              <button
                key={`s-${item.from}`}
                type="button"
                onClick={() => void addSuggestion(item.from, item.to)}
                className="bg-background hover:bg-background/70 rounded-full px-2 py-0.5 text-[11px]"
                title={t("terms.recent.addAlias")}
              >
                {t("terms.recent.suggestion", { from: item.from, to: item.to })}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void dismissRecent()}
              className="text-muted-foreground ml-auto hover:underline"
            >
              {t("terms.recent.dismiss")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">{error}</div>
      )}
      {saveError && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">{saveError}</div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-3">
          {loading && items.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Spinner />
              {t("terms.loading")}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-sm font-medium">
                {filterActive ? t("terms.emptyFiltered") : t("terms.empty.title")}
              </p>
              {!filterActive && (
                <p className="text-muted-foreground max-w-sm text-xs">{t("terms.empty.hint")}</p>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "ring-foreground/10 overflow-hidden rounded-xl ring-1",
                "grid",
                GRID_COLS,
              )}
            >
              <div
                className={cn(
                  SUBGRID_ROW,
                  "bg-muted/40 text-muted-foreground border-b py-2 text-[11px]",
                )}
              >
                <span>{t("terms.table.term")}</span>
                <span>{t("terms.table.aliases")}</span>
                <span className="hidden sm:block">{t("terms.table.definition")}</span>
                <span className="text-center">{t("terms.table.enabled")}</span>
                <span className="text-center">{t("terms.table.actions")}</span>
              </div>

              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(SUBGRID_ROW, "hover:bg-muted/30 border-b py-2 text-sm")}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      title={item.term}
                      className={cn(
                        "truncate font-medium",
                        !item.enabled && "text-muted-foreground",
                      )}
                    >
                      {item.term}
                    </span>
                    {!template && (
                      <span className="text-muted-foreground/70 shrink-0 text-[10px] leading-none">
                        {rowBadge(item)}
                      </span>
                    )}
                  </span>

                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {item.aliases.length === 0 ? (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    ) : (
                      item.aliases.map((alias) => (
                        <span
                          key={alias}
                          className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]"
                        >
                          {alias}
                        </span>
                      ))
                    )}
                  </span>

                  <span className="text-muted-foreground hidden min-w-0 truncate text-xs sm:block">
                    {item.definition || "—"}
                  </span>

                  <span className="flex justify-center">
                    <Switch
                      size="sm"
                      checked={item.enabled}
                      onCheckedChange={(next) =>
                        void save(item.id, { enabled: Boolean(next) })
                      }
                    />
                  </span>

                  <span className="flex items-center justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(item)}>
                      {t("terms.table.edit")}
                    </Button>
                    <DeleteConfirm
                      hint={item.template === "custom" ? undefined : t("terms.confirm.hint")}
                      onConfirm={() => void remove(item.id)}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t">
        <div className="text-muted-foreground mx-auto flex h-10 w-full max-w-7xl items-center gap-3 px-4 text-xs">
          <span className="truncate">
            {filterActive
              ? t("terms.summaryFiltered", {
                  shown: visibleItems.length,
                  total: stats?.total ?? 0,
                })
              : t("terms.summary", { total: stats?.total ?? 0, custom: stats?.custom ?? 0 })}
          </span>
        </div>
      </div>

      <TermsFormDialog
        open={createOpen}
        item={null}
        templates={templates}
        onClose={() => setCreateOpen(false)}
        onSubmit={submitCreate}
      />

      <TermsFormDialog
        open={editing !== null}
        item={editing}
        templates={templates}
        onClose={() => setEditing(null)}
        onSubmit={submitEdit}
      />

      <TermsBulkDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={async () => {
          setBulkOpen(false);
          await reload();
        }}
      />
    </div>
  );
}

/**
 * 删除前的浮层确认：点「删除」弹一个小卡片，再点「确认」才真的删。
 * 比两步式按钮更清楚，也不会因为手滑把一行删掉。
 */
function DeleteConfirm({
  hint,
  onConfirm,
}: {
  hint?: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        {t("terms.delete")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52">
        <p className="text-xs font-medium">{t("terms.confirm.title")}</p>
        {hint && <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>}
        <div className="flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
            {t("terms.confirm.cancel")}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {t("terms.confirm.ok")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
