"use client";

import type { BotReadyData } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { usePipecatClient, useRTVIClientEvent } from "@pipecat-ai/client-react";
import { CopyCheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function Blank() {
  return <span className="text-muted-foreground/60">—</span>;
}

/** Truncated text with a copy-to-clipboard button. */
export function CopyText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <span
      className={cn(
        "flex w-full items-center justify-end gap-1 overflow-hidden",
        className,
      )}
    >
      <span className="min-w-0 truncate">{text}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground flex-none"
              onClick={() => void copyToClipboard()}
              aria-label={t("session.copy")}
            >
              {copied ? <CopyCheckIcon /> : <CopyIcon />}
            </Button>
          }
        />
        <TooltipContent>
          {copied ? t("session.copied") : t("session.copy")}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

export interface SessionInfoViewProps {
  /** Human-readable transport name (e.g. "Daily", "Small WebRTC"). */
  transportName?: string;
  sessionId?: string;
  participantId?: string;
  /** RTVI client library version. */
  clientVersion?: string;
  /** RTVI server version, from the BotReady event. */
  serverVersion?: string;
  noTransportType?: boolean;
  noSessionId?: boolean;
  noParticipantId?: boolean;
  noRTVIVersion?: boolean;
  className?: string;
}

/** Session metadata rows: transport, ids (copyable), RTVI versions. */
export function SessionInfoView({
  transportName,
  sessionId,
  participantId,
  clientVersion,
  serverVersion,
  noTransportType = false,
  noSessionId = false,
  noParticipantId = false,
  noRTVIVersion = false,
  className,
}: SessionInfoViewProps) {
  const rows: Array<[string, React.ReactNode]> = [];
  const { t } = useTranslation();
  if (!noTransportType) {
    rows.push([t("session.transport"), transportName ?? t("session.unknown")]);
  }
  if (!noSessionId) {
    rows.push([
      t("session.sessionId"),
      sessionId ? <CopyText text={sessionId} /> : <Blank />,
    ]);
  }
  if (!noParticipantId) {
    rows.push([
      t("session.participantId"),
      participantId ? <CopyText text={participantId} /> : <Blank />,
    ]);
  }
  if (!noRTVIVersion) {
    rows.push([
      t("session.rtviClient"),
      clientVersion ? `v${clientVersion}` : <Blank />,
    ]);
    rows.push([
      t("session.rtviServer"),
      serverVersion ? `v${serverVersion}` : <Blank />,
    ]);
  }

  return (
    <dl
      data-slot="session-info"
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 overflow-hidden text-sm",
        className,
      )}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="col-span-2 grid grid-cols-subgrid items-center"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-xs">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface SessionInfoProps extends Omit<
  SessionInfoViewProps,
  "transportName" | "clientVersion" | "serverVersion"
> {
  sessionId?: string;
  participantId?: string;
}

/** Requires PipecatClientProvider and TooltipProvider for the copy buttons. */
export function SessionInfo(props: SessionInfoProps) {
  const client = usePipecatClient();
  const [serverVersion, setServerVersion] = useState<string | undefined>(
    undefined,
  );

  useRTVIClientEvent(RTVIEvent.Disconnected, () => {
    setServerVersion(undefined);
  });

  useRTVIClientEvent(RTVIEvent.BotReady, (botData: BotReadyData) => {
    setServerVersion(botData.version);
  });

  // Derive a friendly transport name from the transport implementation.
  const transportServiceName = (
    client?.transport as unknown as {
      __proto__?: { constructor?: { SERVICE_NAME?: string } };
    } | null
  )?.__proto__?.constructor?.SERVICE_NAME;

  let transportName = "Small WebRTC";
  if (client && "dailyCallClient" in client.transport) {
    transportName = "Daily";
  } else if (transportServiceName === "small-webrtc-transport") {
    transportName = "Small WebRTC";
  } else if (transportServiceName === "moq-transport") {
    transportName = "MoQ";
  } else if (transportServiceName) {
    transportName = transportServiceName;
  }

  return (
    <SessionInfoView
      transportName={transportName}
      clientVersion={client?.version}
      serverVersion={serverVersion}
      {...props}
    />
  );
}
