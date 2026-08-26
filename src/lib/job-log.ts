import type { ProgressEvent } from "./progress";

export type JobLogLevel = "info" | "warn" | "error";

export function emitJobLog(
  send: (event: ProgressEvent) => void,
  index: number,
  jobUrl: string,
  message: string,
  level: JobLogLevel = "info",
) {
  const line = `[tailor job ${index}] ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  send({
    type: "log",
    index,
    jobUrl,
    level,
    message,
    at: Date.now(),
  });
}

export function elapsedSec(startMs: number) {
  return Math.round((Date.now() - startMs) / 1000);
}
