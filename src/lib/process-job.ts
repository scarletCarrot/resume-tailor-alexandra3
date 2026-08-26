import { scoreAtsMatch } from "./ats-score";
import { extractJobDescription } from "./extract";
import { generateTailoredPackage } from "./generate";
import { saveJobPackage } from "./package";
import { scrapeJobDescription } from "./scrape";
import { validateAndFixResume } from "./validate-resume";
import type { JobStep } from "./progress";
import type { CandidateProfile, ExtractedJD, PersonalInfo } from "./types";

export type PreparedJob = {
  rawText: string;
  extracted: ExtractedJD;
};

export type PackagedJob = {
  index: number;
  jobUrl: string;
  company: string;
  zipName: string;
  folderName: string;
  resumeDocxName: string;
  resumePdfName: string;
  coverLetterDocxName: string;
  downloads: {
    zipBase64: string;
    resumeDocxBase64: string;
    coverLetterDocxBase64: string;
  };
  extracted: ExtractedJD;
  atsScore: number;
  atsSummary: string;
};

/** Scrape (or use pasted JD) + extract. Own serverless budget when run as phase 1. */
export async function prepareOneJob(options: {
  jobUrl: string;
  manualJd?: string;
  onStep: (step: JobStep, message: string) => void;
}): Promise<PreparedJob> {
  const { jobUrl, manualJd, onStep } = options;

  let rawText: string;
  let pageTitle: string;

  const pasted = manualJd?.trim();
  if (pasted && pasted.length >= 80) {
    onStep("scraping", "Using pasted job description (scrape skipped)…");
    rawText = pasted.slice(0, 50000);
    pageTitle = `Manual JD for ${jobUrl}`;
    onStep(
      "fetch_jd",
      `Loaded manual JD (${rawText.length.toLocaleString()} chars)`,
    );
  } else {
    onStep("scraping", "Scraping job page…");
    const scraped = await scrapeJobDescription(jobUrl);
    rawText = scraped.rawText;
    pageTitle = scraped.pageTitle;
    onStep(
      "fetch_jd",
      `Fetched JD (${rawText.length.toLocaleString()} chars)`,
    );
  }

  onStep("extracting", "Extracting structured JD…");
  const extracted = await extractJobDescription(rawText, pageTitle, jobUrl);

  return { rawText, extracted };
}

/**
 * Generate resume/cover letter + validate + zip.
 * Resume prompt/output unchanged; runs as its own Vercel invocation (fresh 300s).
 */
export async function generateOneJob(options: {
  index: number;
  jobUrl: string;
  profile: CandidateProfile;
  personal: PersonalInfo;
  rawText: string;
  extracted: ExtractedJD;
  onStep: (step: JobStep, message: string) => void;
}): Promise<PackagedJob> {
  const { index, jobUrl, profile, personal, rawText, extracted, onStep } =
    options;

  onStep("generating", "Generating resume & cover letter…");
  const tailored = await generateTailoredPackage(profile, extracted, rawText);

  onStep("validating", "Validating resume format and content…");
  const validation = validateAndFixResume(tailored, profile, extracted);
  const fixed = validation.package;

  if (!validation.ok) {
    const critical = validation.issues
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join("; ");
    throw new Error(
      critical || "Resume failed validation after formatting fixes.",
    );
  }

  const fixedCount = validation.issues.filter((i) => i.level === "fixed").length;
  const ats = scoreAtsMatch(fixed.resume, extracted, rawText);
  onStep(
    "zipping",
    `Validated${fixedCount ? ` (${fixedCount} fixes)` : ""} · ATS ${ats.score}/100 · packaging…`,
  );

  const saved = await saveJobPackage({
    index,
    jobUrl,
    rawJd: rawText,
    extracted,
    personal,
    tailored: fixed,
  });

  return {
    index,
    jobUrl,
    company: saved.company,
    zipName: saved.zipName,
    folderName: saved.folderName,
    resumeDocxName: saved.resumeDocxName,
    resumePdfName: saved.resumePdfName,
    coverLetterDocxName: saved.coverLetterDocxName,
    downloads: saved.downloads,
    extracted,
    atsScore: ats.score,
    atsSummary: `ATS score ${ats.score}/100`,
  };
}

/** Full pipeline (local / single-shot). Prefer phased API on Vercel. */
export async function processOneJob(options: {
  index: number;
  jobUrl: string;
  profile: CandidateProfile;
  personal: PersonalInfo;
  manualJd?: string;
  onStep: (step: JobStep, message: string) => void;
}): Promise<PackagedJob> {
  const prepared = await prepareOneJob({
    jobUrl: options.jobUrl,
    manualJd: options.manualJd,
    onStep: options.onStep,
  });

  return generateOneJob({
    index: options.index,
    jobUrl: options.jobUrl,
    profile: options.profile,
    personal: options.personal,
    rawText: prepared.rawText,
    extracted: prepared.extracted,
    onStep: options.onStep,
  });
}
