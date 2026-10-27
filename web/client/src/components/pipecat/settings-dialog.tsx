"use client";

import { SettingsIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LANGUAGES, setLanguage, type AppLanguage } from "@/i18n";
import type { ThemeMode } from "@/lib/theme";
import {
  ASR_PROVIDERS,
  fetchSettings,
  findProvider,
  LLM_PROVIDERS,
  saveSettings,
  TTS_PROVIDERS,
  type AppSettings,
  type ProviderMeta,
  type TtsProviderMeta,
} from "@/lib/settings";

type Section = "asr" | "llm" | "tts";
type Status = "idle" | "loading" | "saving" | "saved" | "error";

/** 表单规范见 web/client/FORM_SPEC.md：两列等宽、gap-3、控件统一 h-8。 */
const FORM_GRID = "grid gap-3 sm:grid-cols-2";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
  { value: "system", labelKey: "settings.theme.system" },
];

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 ${className ?? ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProviderSelect({
  providers,
  value,
  onChange,
}: {
  providers: ProviderMeta[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={providers.map(({ value, label }) => ({ value, label }))}
      value={value}
      onValueChange={(next) => onChange(String(next))}
    >
      <SelectTrigger className="h-8 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {providers.map(({ value, label }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      value={value}
      rows={7}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    />
  );
}

export function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
}: {
  open: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"general" | "models">("general");
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    setMessage("");
    fetchSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setStatus("idle");
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const patch = useCallback((section: Section, key: string, value: string) => {
    setSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        [section]: { ...current[section], [key]: value },
      } as AppSettings;
    });
    setStatus("idle");
    setMessage("");
  }, []);

  const changeAsrProvider = useCallback((provider: string) => {
    const meta = findProvider(ASR_PROVIDERS, provider);
    if (!meta) return;
    setSettings((current) =>
      current
        ? {
            ...current,
            asr: {
              ...current.asr,
              provider,
              model: meta.defaultModel,
              base_url: meta.defaultBaseUrl,
            },
          }
        : current,
    );
    setStatus("idle");
    setMessage("");
  }, []);

  const changeLlmProvider = useCallback((provider: string) => {
    const meta = findProvider(LLM_PROVIDERS, provider);
    if (!meta) return;
    setSettings((current) =>
      current
        ? {
            ...current,
            llm: {
              ...current.llm,
              provider,
              model: meta.defaultModel,
              base_url: meta.defaultBaseUrl,
            },
          }
        : current,
    );
    setStatus("idle");
    setMessage("");
  }, []);

  const changeTtsProvider = useCallback((provider: string) => {
    const meta = findProvider<TtsProviderMeta>(TTS_PROVIDERS, provider);
    if (!meta) return;
    setSettings((current) =>
      current
        ? {
            ...current,
            tts: {
              ...current.tts,
              provider,
              model: meta.defaultModel,
              base_url: meta.defaultBaseUrl,
              voice: meta.defaultVoice,
            },
          }
        : current,
    );
    setStatus("idle");
    setMessage("");
  }, []);

  const onSave = useCallback(async () => {
    if (!settings) return;
    setStatus("saving");
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      setStatus("saved");
      setMessage(t("settings.saved"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [settings, t]);

  if (!open) return null;

  const ttsMeta = settings
    ? findProvider<TtsProviderMeta>(TTS_PROVIDERS, settings.tts.provider)
    : undefined;
  const showLlmBaseUrl = !!settings && settings.llm.provider !== "anthropic";
  const showAsrBaseUrl = !!settings && settings.asr.provider !== "deepgram";
  const currentLanguage: AppLanguage = i18n.language.startsWith("en")
    ? "en"
    : "zh";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="flex h-[600px] max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("settings.close")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "general" | "models")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="shrink-0 border-b border-border px-4 pt-2">
            <TabsList variant="line" className="gap-6">
              <TabsTrigger value="general">
                {t("settings.tabs.general")}
              </TabsTrigger>
              <TabsTrigger value="models">
                {t("settings.tabs.models")}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="general" className="grid max-w-md gap-3">
              <Field label={t("settings.fields.appLanguage")}>
                <Select
                  items={LANGUAGES.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  value={currentLanguage}
                  onValueChange={(next) =>
                    setLanguage(String(next) as AppLanguage)
                  }
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {LANGUAGES.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label={t("settings.fields.theme")}>
                <Select
                  items={THEME_OPTIONS.map(({ value, labelKey }) => ({
                    value,
                    label: t(labelKey),
                  }))}
                  value={theme}
                  onValueChange={(next) =>
                    onThemeChange(String(next) as ThemeMode)
                  }
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {THEME_OPTIONS.map(({ value, labelKey }) => (
                      <SelectItem key={value} value={value}>
                        {t(labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </TabsContent>

            <TabsContent value="models">
              {status === "loading" || !settings ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  {status === "error" ? (
                    <span className="text-destructive">{message}</span>
                  ) : (
                    <>
                      <Spinner /> {t("settings.loading")}
                    </>
                  )}
                </div>
              ) : (
                <div className="grid gap-6">
                  <section className="grid gap-3" data-slot="settings-section">
                    <h3 className="text-sm font-semibold">
                      {t("settings.sections.asr")}
                    </h3>
                    <Field label={t("settings.fields.provider")}>
                      <ProviderSelect
                        providers={ASR_PROVIDERS}
                        value={settings.asr.provider}
                        onChange={changeAsrProvider}
                      />
                    </Field>

                    <div className={FORM_GRID}>
                      <Field label={t("settings.fields.model")}>
                        <Input
                          value={settings.asr.model}
                          placeholder="qwen3-asr-flash"
                          onChange={(event) =>
                            patch("asr", "model", event.target.value)
                          }
                        />
                      </Field>
                      <Field label={t("settings.fields.asrLanguage")}>
                        <Input
                          value={settings.asr.language}
                          placeholder="zh"
                          onChange={(event) =>
                            patch("asr", "language", event.target.value)
                          }
                        />
                      </Field>
                    </div>

                    {showAsrBaseUrl && (
                      <Field label={t("settings.fields.baseUrl")}>
                        <Input
                          value={settings.asr.base_url}
                          placeholder="https://api.openai.com/v1"
                          onChange={(event) =>
                            patch("asr", "base_url", event.target.value)
                          }
                        />
                      </Field>
                    )}

                    <Field label={t("settings.fields.apiKey")}>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={settings.asr.api_key}
                        placeholder="sk-…"
                        onChange={(event) =>
                          patch("asr", "api_key", event.target.value)
                        }
                      />
                    </Field>
                  </section>

                  <Separator />

                  <section className="grid gap-3" data-slot="settings-section">
                    <h3 className="text-sm font-semibold">
                      {t("settings.sections.llm")}
                    </h3>
                    <Field label={t("settings.fields.provider")}>
                      <ProviderSelect
                        providers={LLM_PROVIDERS}
                        value={settings.llm.provider}
                        onChange={changeLlmProvider}
                      />
                    </Field>

                    <div className={FORM_GRID}>
                      <Field
                        label={t("settings.fields.model")}
                        className={showLlmBaseUrl ? "" : "sm:col-span-2"}
                      >
                        <Input
                          value={settings.llm.model}
                          placeholder="gpt-4o-mini"
                          onChange={(event) =>
                            patch("llm", "model", event.target.value)
                          }
                        />
                      </Field>
                      {showLlmBaseUrl && (
                        <Field label={t("settings.fields.baseUrl")}>
                          <Input
                            value={settings.llm.base_url}
                            placeholder="https://api.openai.com/v1"
                            onChange={(event) =>
                              patch("llm", "base_url", event.target.value)
                            }
                          />
                        </Field>
                      )}
                    </div>

                    <Field label={t("settings.fields.apiKey")}>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={settings.llm.api_key}
                        placeholder="sk-…"
                        onChange={(event) =>
                          patch("llm", "api_key", event.target.value)
                        }
                      />
                    </Field>

                    <Field label={t("settings.fields.systemPrompt")}>
                      <ModelTextarea
                        value={settings.llm.system_prompt}
                        onChange={(value) =>
                          patch("llm", "system_prompt", value)
                        }
                      />
                    </Field>
                  </section>

                  <Separator />

                  <section className="grid gap-3" data-slot="settings-section">
                    <h3 className="text-sm font-semibold">
                      {t("settings.sections.tts")}
                    </h3>
                    <Field label={t("settings.fields.provider")}>
                      <ProviderSelect
                        providers={TTS_PROVIDERS}
                        value={settings.tts.provider}
                        onChange={changeTtsProvider}
                      />
                    </Field>

                    <div className={FORM_GRID}>
                      <Field label={t("settings.fields.model")}>
                        <Input
                          value={settings.tts.model}
                          placeholder="speech-2.8-turbo"
                          onChange={(event) =>
                            patch("tts", "model", event.target.value)
                          }
                        />
                      </Field>
                      <Field label={t("settings.fields.voice")}>
                        <Input
                          value={settings.tts.voice}
                          placeholder="Calm_Woman"
                          onChange={(event) =>
                            patch("tts", "voice", event.target.value)
                          }
                        />
                      </Field>
                    </div>

                    <div className={FORM_GRID}>
                      <Field
                        label={t("settings.fields.language")}
                        className={ttsMeta?.needsGroupId ? "" : "sm:col-span-2"}
                      >
                        <Input
                          value={settings.tts.language}
                          placeholder="zh"
                          onChange={(event) =>
                            patch("tts", "language", event.target.value)
                          }
                        />
                      </Field>
                      {ttsMeta?.needsGroupId && (
                        <Field label={t("settings.fields.groupId")}>
                          <Input
                            value={settings.tts.group_id}
                            placeholder="Minimax GroupId"
                            onChange={(event) =>
                              patch("tts", "group_id", event.target.value)
                            }
                          />
                        </Field>
                      )}
                    </div>

                    <Field label={t("settings.fields.baseUrl")}>
                      <Input
                        value={settings.tts.base_url}
                        placeholder={t("settings.placeholders.default")}
                        onChange={(event) =>
                          patch("tts", "base_url", event.target.value)
                        }
                      />
                    </Field>

                    <Field label={t("settings.fields.apiKey")}>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={settings.tts.api_key}
                        placeholder="sk-…"
                        onChange={(event) =>
                          patch("tts", "api_key", event.target.value)
                        }
                      />
                    </Field>
                  </section>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex h-14 shrink-0 items-center justify-between border-t border-border px-4">
          <span
            className={`min-w-0 truncate text-xs ${
              status === "error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {status === "saving" || status === "saved" || status === "error"
              ? message || (status === "saving" ? t("settings.saving") : "")
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {tab === "models" ? t("settings.cancel") : t("settings.close")}
            </Button>
            {tab === "models" && (
              <Button
                size="sm"
                disabled={!settings || status === "saving"}
                onClick={() => void onSave()}
              >
                {status === "saving" ? t("settings.saving") : t("settings.save")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
