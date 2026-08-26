import { z } from "zod";

const extractedJdSchema = z.object({
  company: z.string(),
  jobTitle: z.string(),
  summary: z.string(),
  type: z.enum([
    "AI Engineer",
    "Data Engineer",
    "Software Engineer",
    "Data Analyst",
    "Data Scientist",
  ]),
  salaryExpectation: z.string(),
  workMode: z.enum(["Remote", "Hybrid", "Onsite"]),
  hardTechnicalSkills: z.array(z.string()),
  softSkills: z.array(z.string()),
});

export const tailorRequestSchema = z
  .object({
    /** prepare = scrape+extract; generate = LLM resume+package (separate Vercel budgets) */
    phase: z.enum(["prepare", "generate"]).default("prepare"),
    jobUrls: z.array(z.string().min(1)).min(1),
    indices: z.array(z.number().int().positive()).optional(),
    /** Optional pasted JD text per URL; empty/omitted entries still scrape */
    manualJds: z.array(z.string()).optional(),
    /** Required for phase=generate: raw JD text per job */
    rawTexts: z.array(z.string().min(1)).optional(),
    /** Required for phase=generate: extracted JD per job */
    extracteds: z.array(extractedJdSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.indices && value.indices.length !== value.jobUrls.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "indices length must match jobUrls length",
        path: ["indices"],
      });
    }
    if (value.manualJds && value.manualJds.length !== value.jobUrls.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "manualJds length must match jobUrls length",
        path: ["manualJds"],
      });
    }

    if (value.phase === "prepare") {
      value.jobUrls.forEach((jobUrl, index) => {
        const manualJd = value.manualJds?.[index]?.trim() || "";
        let validUrl = true;
        try {
          new URL(jobUrl);
        } catch {
          validUrl = false;
        }
        if (!validUrl && manualJd.length < 80) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Provide a valid job URL or at least 80 characters of JD text",
            path: ["jobUrls", index],
          });
        }
      });
      return;
    }

    if (!value.rawTexts || value.rawTexts.length !== value.jobUrls.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rawTexts length must match jobUrls length for generate phase",
        path: ["rawTexts"],
      });
    }
    if (!value.extracteds || value.extracteds.length !== value.jobUrls.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "extracteds length must match jobUrls length for generate phase",
        path: ["extracteds"],
      });
    }
  });

export type TailorRequest = z.infer<typeof tailorRequestSchema>;

export function parseTailorRequest(body: unknown): TailorRequest {
  return tailorRequestSchema.parse(body);
}
