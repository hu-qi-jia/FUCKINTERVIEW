"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CardsStep } from "@/components/materials/cards-step";
import { CoachPanel } from "@/components/materials/coach-panel";
import { InlineConfirmButton } from "@/components/materials/inline-confirm-button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  consolidateMaterial,
  type ExperienceCard,
  type InterviewLanguage,
  type InterviewProfile,
  type MaterialKind,
  type ProfilePatch,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

const LANGUAGES: { value: InterviewLanguage; labelKey: string }[] = [
  { value: "zh", labelKey: "materials.steps.language.zh" },
  { value: "en", labelKey: "materials.steps.language.en" },
];

export function ProfileFlow({
  profile,
  busy,
  focusNameToken,
  onPatch,
  onReplace,
  onApplyCard,
  onFlush,
  onBusyChange,
}: {
  profile: InterviewProfile;
  busy: boolean;
  focusNameToken: number;
  onPatch: (patch: ProfilePatch) => void;
  onReplace: (profile: InterviewProfile) => void;
  onApplyCard: (card: ExperienceCard) => void;
  onFlush: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);

  const completed = [
    Boolean(profile.name.trim()),
    true,
    Boolean(profile.resume.content.trim()),
    Boolean(profile.jobDescription.content.trim()),
    profile.cards.some((card) => card.status === "ready"),
  ];
  const firstIncomplete = completed.findIndex((done) => !done);

  const [openStep, setOpenStep] = useState(
    firstIncomplete === -1 ? 0 : firstIncomplete,
  );

  // 切换档案时回到第一个未完成的步骤。
  useEffect(() => {
    setOpenStep(firstIncomplete === -1 ? 0 : firstIncomplete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => {
    if (focusNameToken === 0) return;
    setOpenStep(0);
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [focusNameToken]);

  const steps = [
    {
      key: "name",
      title: t("materials.steps.name.title"),
      description: t("materials.steps.name.description"),
      content: (
        <div className="grid max-w-md gap-1.5">
          <Input
            ref={nameRef}
            value={profile.name}
            placeholder={t("materials.steps.name.placeholder")}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        </div>
      ),
    },
    {
      key: "language",
      title: t("materials.steps.language.title"),
      description: t("materials.steps.language.description"),
      content: (
        <div className="grid max-w-md gap-1.5">
          <Select
            items={LANGUAGES.map(({ value, labelKey }) => ({
              value,
              label: t(labelKey),
            }))}
            value={profile.language}
            onValueChange={(value) =>
              onPatch({ language: value as InterviewLanguage })
            }
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {LANGUAGES.map(({ value, labelKey }) => (
                <SelectItem key={value} value={value}>
                  {t(labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t("materials.steps.language.hint")}
          </p>
        </div>
      ),
    },
    {
      key: "resume",
      title: t("materials.steps.resume.title"),
      description: t("materials.steps.resume.description"),
      content: (
        <MaterialStep
          kind="resume"
          profile={profile}
          disabled={busy}
          onPatch={onPatch}
        />
      ),
    },
    {
      key: "jobDescription",
      title: t("materials.steps.jobDescription.title"),
      description: t("materials.steps.jobDescription.description"),
      content: (
        <MaterialStep
          kind="jobDescription"
          profile={profile}
          disabled={busy}
          onPatch={onPatch}
        />
      ),
    },
    {
      key: "cards",
      title: t("materials.steps.cards.title"),
      description: t("materials.steps.cards.description"),
      content: (
        <CardsStep
          profile={profile}
          busy={busy}
          onPatch={onPatch}
          onReplace={onReplace}
          onApplyCard={onApplyCard}
          onFlush={onFlush}
          onBusyChange={onBusyChange}
        />
      ),
    },
  ];

  return (
    <>
      <ol className="grid">
        {steps.map((step, index) => (
          <StepRow
            key={step.key}
            index={index}
            total={steps.length}
            title={step.title}
            description={step.description}
            completed={completed[index]}
            open={openStep === index}
            onToggle={() => setOpenStep(openStep === index ? -1 : index)}
          >
            {step.content}
          </StepRow>
        ))}
      </ol>

      <CoachPanel profile={profile} busy={busy} onPatch={onPatch} />
    </>
  );
}

function StepRow({
  index,
  total,
  title,
  description,
  completed,
  open,
  onToggle,
  children,
}: {
  index: number;
  total: number;
  title: string;
  description: string;
  completed: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.625rem_minmax(0,1fr)] gap-x-4">
      <div className="relative flex justify-center">
        {index < total - 1 && (
          <span
            aria-hidden
            className="bg-border absolute top-6.5 bottom-0 w-px"
          />
        )}
        <span
          className={cn(
            "relative z-10 flex size-6.5 items-center justify-center rounded-full border text-xs font-medium transition-colors",
            completed
              ? "border-primary bg-primary text-primary-foreground"
              : open
                ? "border-primary bg-background text-primary"
                : "border-border bg-background text-muted-foreground",
          )}
        >
          {completed ? <CheckIcon className="size-3.5" /> : index + 1}
        </span>
      </div>

      <div className={cn("min-w-0", index < total - 1 && "pb-5")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-[1.625rem] font-medium">
              {title}
            </span>
            {description && (
              <span className="text-muted-foreground mt-0.5 block text-xs">
                {description}
              </span>
            )}
          </span>
          <ChevronDownIcon
            className={cn(
              "text-muted-foreground mt-1 size-4 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="animate-in fade-in-0 pt-3 duration-200">
            {children}
          </div>
        )}
      </div>
    </li>
  );
}

function MaterialStep({
  kind,
  profile,
  disabled,
  onPatch,
}: {
  kind: MaterialKind;
  profile: InterviewProfile;
  disabled: boolean;
  onPatch: (patch: ProfilePatch) => void;
}) {
  const { t } = useTranslation();
  const textareaId = useId();
  const section = kind === "resume" ? profile.resume : profile.jobDescription;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = busy || disabled;

  const patchSection = (patch: Partial<typeof section>) => {
    onPatch(
      kind === "resume" ? { resume: patch } : { jobDescription: patch },
    );
  };

  const runConsolidate = async () => {
    if (locked || !section.content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const text = await consolidateMaterial(
        profile.id,
        kind,
        section.content,
        profile.language,
      );
      patchSection({
        content: text,
        original: section.original || section.content,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const canUndo =
    Boolean(section.original) && section.original !== section.content;

  return (
    <div className="grid gap-2">
      <Textarea
        id={textareaId}
        value={section.content}
        disabled={locked}
        placeholder={t(
          kind === "resume"
            ? "materials.steps.resume.placeholder"
            : "materials.steps.jobDescription.placeholder",
        )}
        className="field-sizing-fixed h-56 resize-y"
        onChange={(event) => patchSection({ content: event.target.value })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !section.content.trim()}
          onClick={() => void runConsolidate()}
        >
          {busy ? (
            <Spinner className="size-3.5" />
          ) : null}
          {busy
            ? t("materials.consolidate.running")
            : t("materials.consolidate.action")}
        </Button>

        {canUndo && (
          <InlineConfirmButton
            size="sm"
            variant="ghost"
            disabled={locked}
            label={t("materials.consolidate.undo")}
            confirmLabel={t("materials.consolidate.confirmUndo")}
            onConfirm={() => patchSection({ content: section.original })}
          />
        )}

        <span className="text-muted-foreground ml-auto text-xs">
          {t("materials.consolidate.hint")}
        </span>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
