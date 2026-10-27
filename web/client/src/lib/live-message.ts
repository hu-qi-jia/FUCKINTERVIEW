/** A line of the candidate's transcript, collected from the mic session. */
export interface LiveMessage {
  id: string;
  text: string;
  /** ISO timestamp; falls back to arrival time when the server omits it. */
  createdAt: string;
  from: "candidate";
}

/** Normalises a server transcript timestamp into an ISO string. */
export function transcriptTimestamp(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}
