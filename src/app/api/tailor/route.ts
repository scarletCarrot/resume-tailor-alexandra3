import { ZodError } from "zod";
import { generateOneJob, prepareOneJob } from "@/lib/process-job";
import { CANDIDATE_PROFILE } from "@/lib/profile";
import { JOB_STEPS, type JobStep, type ProgressEvent } from "@/lib/progress";
import type { ExtractedJD } from "@/lib/types";
import { parseTailorRequest } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 300;

function encodeSse(event: ProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  let payload;
  try {
    const body = await request.json();
    payload = parseTailorRequest(body);
  } catch (err) {
    const message =
      err instanceof ZodError
        ? "Invalid request"
        : err instanceof Error
          ? err.message
          : "Invalid request";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const profile = CANDIDATE_PROFILE;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };

      // Keep the SSE connection alive during long OpenRouter waits.
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);

      try {
        const outcomes = await Promise.all(
          payload.jobUrls.map(async (jobUrl, i) => {
            const index = payload.indices?.[i] ?? i + 1;
            let currentStep: JobStep =
              payload.phase === "generate" ? "generating" : JOB_STEPS[0];

            try {
              if (payload.phase === "prepare") {
                const prepared = await prepareOneJob({
                  jobUrl,
                  manualJd: payload.manualJds?.[i],
                  onStep: (step, message) => {
                    currentStep = step;
                    send({
                      type: "step",
                      index,
                      jobUrl,
                      step,
                      message,
                    });
                  },
                });

                send({
                  type: "job_prepared",
                  index,
                  jobUrl,
                  rawText: prepared.rawText,
                  extracted: prepared.extracted,
                });

                return { ok: true as const };
              }

              const rawText = payload.rawTexts![i];
              const extracted = payload.extracteds![i] as ExtractedJD;

              // Mark early steps done for UI when resuming at generate.
              for (const step of ["scraping", "fetch_jd", "extracting"] as const) {
                send({
                  type: "step",
                  index,
                  jobUrl,
                  step,
                  message:
                    step === "extracting"
                      ? "Structured JD ready"
                      : "Prepared",
                });
              }

              const result = await generateOneJob({
                index,
                jobUrl,
                profile,
                personal: profile.personal,
                rawText,
                extracted,
                onStep: (step, message) => {
                  currentStep = step;
                  send({
                    type: "step",
                    index,
                    jobUrl,
                    step,
                    message,
                  });
                },
              });

              send({
                type: "job_done",
                index,
                jobUrl,
                company: result.company,
                zipName: result.zipName,
                folderName: result.folderName,
                resumeDocxName: result.resumeDocxName,
                resumePdfName: result.resumePdfName,
                coverLetterDocxName: result.coverLetterDocxName,
                downloads: result.downloads,
                atsScore: result.atsScore,
                atsSummary: result.atsSummary,
                extracted: result.extracted,
              });

              return { ok: true as const };
            } catch (err) {
              const message =
                err instanceof Error
                  ? err.message
                  : "Unknown error for this job.";
              send({
                type: "job_error",
                index,
                jobUrl,
                step: currentStep,
                error: message,
              });
              return { ok: false as const };
            }
          }),
        );

        const succeeded = outcomes.filter((o) => o.ok).length;
        send({
          type: "done",
          succeeded,
          failed: outcomes.length - succeeded,
        });
      } catch (err) {
        send({
          type: "fatal",
          error: err instanceof Error ? err.message : "Unexpected error",
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
