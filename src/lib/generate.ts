import type {
  CandidateProfile,
  ExtractedJD,
  SkillGroup,
  TailoredPackage,
  TailoredResume,
} from "./types";
import { tailorExperienceTitle } from "./job-title";
import type { JobLogLevel } from "./job-log";
import { getLlmClient, getLlmModel, getLlmTimeoutMs, isAbortError } from "./llm";
import { parseModelJson } from "./parse-json";
import {
  buildFallbackSummary,
  buildFillerBullet,
  dedupeBullets,
  sanitizePlainText,
} from "./validate-resume";

const SHARED_RULES = `Hard rules:
1. Resume sections: Summary, Skills, Experience, Education.
2. Skills MUST be classified into compact groups (not one skill per line). Use 4-6 groups such as:
   Languages, Frameworks/Libraries, Cloud/DevOps, Data/AI, Databases, Tools/Practices.
   Each group has a short category name and 4-10 comma-ready item strings.
3. Each experience MUST include:
   - overview: 1-2 sentences (about 25-45 words) describing what the company does and the candidate's core responsibility in that role, tailored toward the target JD.
   - exactly 7 bullet points of accomplishments.
4. Each bullet must be professional and specific (~25-40 words). Describe concrete work done.
5. Use concrete absolute measures where appropriate (counts, scale, volume, latency, users, datasets, or dollars). NEVER use percentages, percentage points, or the % symbol anywhere in the resume or cover letter.
6. Include slightly MORE relevant experience breadth than the JD strictly requires.
7. Mirror JD terminology and hard skills heavily for ATS scoring.
8. keywords: array of important JD keywords/phrases that should be bolded.
9. Keep the candidate's company names, periods, locations, and education exactly as given. Align every experience title to the extracted JD type. Use only Software Engineer, Data Engineer, Data Analyst, Data Scientist, or AI Engineer as the title family. The candidate's most recent senior role must use "Lead" when the JD title is a Lead role; otherwise use "Senior".
10. Do not invent employers or schools. Invent realistic overviews and accomplishment bullets grounded in the companies and JD.
11. Return ONLY valid compact JSON. Escape all double quotes inside strings. Do not wrap in markdown.
12. NEVER use markdown in any string (**bold**, *italic*, backticks, headings). Plain text only. Keyword bolding is applied later by the document formatter.`;

const RESUME_SYSTEM_PROMPT = `You are an expert ATS resume writer.
Create a tailored resume that maximizes ATS keyword match for the target role.

${SHARED_RULES}

JSON shape:
{
  "summary": string,
  "skills": [{ "category": string, "items": string[] }],
  "experiences": [{ "company": string, "title": string, "period": string, "location": string, "overview": string, "bullets": string[] }],
  "education": [{ "school": string, "degree": string, "period": string, "location": string }],
  "keywords": string[]
}`;

const COVER_LETTER_SYSTEM_PROMPT = `You are an expert career coach writing a tailored cover letter.
The resume has already been written. Write a cover letter that complements it for the target role.

Hard rules:
1. Cover letter: 3-4 short paragraphs in ONE string, use \\n\\n between paragraphs. No icons/emojis.
2. Mirror JD terminology and reference the candidate's relevant experience from the provided resume.
3. Use concrete absolute measures where appropriate. NEVER use percentages, percentage points, or the % symbol.
4. Do not invent employers or schools not present in the resume.
5. Return ONLY valid compact JSON. Escape all double quotes inside strings. Do not wrap in markdown.
6. NEVER use markdown in any string. Plain text only.

JSON shape:
{
  "coverLetter": string
}`;

function buildUserPayload(
  profile: CandidateProfile,
  extracted: ExtractedJD,
  rawJd: string,
) {
  return JSON.stringify({
    candidate: profile,
    extractedJd: extracted,
    rawJobDescription: rawJd.slice(0, 12000),
  });
}

function buildCoverLetterPayload(
  profile: CandidateProfile,
  extracted: ExtractedJD,
  rawJd: string,
  resume: TailoredResume,
) {
  return JSON.stringify({
    candidate: profile.personal,
    extractedJd: extracted,
    rawJobDescription: rawJd.slice(0, 8000),
    tailoredResume: {
      summary: resume.summary,
      skills: resume.skills,
      experiences: resume.experiences.map((exp) => ({
        company: exp.company,
        title: exp.title,
        overview: exp.overview,
        bullets: exp.bullets.slice(0, 3),
      })),
    },
  });
}

export async function generateTailoredPackage(
  profile: CandidateProfile,
  extracted: ExtractedJD,
  rawJd: string,
  onLog?: (message: string, level?: JobLogLevel) => void,
  onProgress?: (message: string) => void,
): Promise<TailoredPackage> {
  const client = getLlmClient();
  const model = getLlmModel();
  const userPayload = buildUserPayload(profile, extracted, rawJd);
  const phaseStarted = Date.now();
  const phaseBudgetMs = 290_000;

  const nextTimeoutMs = () => {
    const remaining = phaseBudgetMs - (Date.now() - phaseStarted);
    if (remaining < 15_000) {
      throw new Error(
        "Generate phase budget exhausted. Please retry — the same model will be used.",
      );
    }
    return Math.min(getLlmTimeoutMs(), remaining);
  };

  onLog?.(`Calling OpenRouter (${model}) — resume (1/2)…`);
  onProgress?.("Generating tailored resume (1/2)…");

  const resumeContent = await requestJsonWithRepair({
    client,
    model,
    systemPrompt: RESUME_SYSTEM_PROMPT,
    userPayload,
    onLog,
    label: "resume",
    getTimeoutMs: nextTimeoutMs,
    parse: (content) => {
      const parsed = parseModelJson<
        Partial<TailoredResume> & { resume?: TailoredResume }
      >(content);
      const rawResume =
        parsed.resume ??
        (Array.isArray(parsed.experiences) || parsed.summary
          ? (parsed as TailoredResume)
          : undefined);
      return normalizeResume(rawResume, profile, extracted);
    },
  });

  onLog?.("Resume generated — starting cover letter (2/2)…");
  onProgress?.("Generating cover letter (2/2)…");

  const coverPayload = buildCoverLetterPayload(
    profile,
    extracted,
    rawJd,
    resumeContent,
  );

  const coverLetter = await requestJsonWithRepair({
    client,
    model,
    systemPrompt: COVER_LETTER_SYSTEM_PROMPT,
    userPayload: coverPayload,
    onLog,
    label: "cover letter",
    getTimeoutMs: nextTimeoutMs,
    parse: (content) => {
      const parsed = parseModelJson<{ coverLetter?: string }>(content);
      const letter = String(parsed.coverLetter || "").trim();
      if (!letter) {
        throw new Error("Cover letter field missing from model response.");
      }
      return sanitizePlainText(letter);
    },
  });

  onLog?.("Resume and cover letter generation complete.");
  return { resume: resumeContent, coverLetter };
}

async function requestJsonWithRepair<T>(options: {
  client: ReturnType<typeof getLlmClient>;
  model: string;
  systemPrompt: string;
  userPayload: string;
  onLog?: (message: string, level?: JobLogLevel) => void;
  label: string;
  getTimeoutMs: () => number;
  parse: (content: string) => T;
}): Promise<T> {
  const {
    client,
    model,
    systemPrompt,
    userPayload,
    onLog,
    label,
    getTimeoutMs,
    parse,
  } = options;

  let content = await requestJson(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
    onLog,
    label,
    getTimeoutMs(),
  );

  try {
    const result = parse(content);
    onLog?.(`Parsed ${label} JSON successfully.`);
    return result;
  } catch (firstError) {
    onLog?.(`Invalid JSON for ${label} — requesting repair…`, "warn");
    content = await requestJson(
      client,
      model,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
        { role: "assistant", content },
        {
          role: "user",
          content:
            "Your previous reply was invalid JSON. Return ONLY repaired valid JSON for the same request. No markdown, no commentary.",
        },
      ],
      onLog,
      `${label} repair`,
      getTimeoutMs(),
    );
    try {
      const result = parse(content);
      onLog?.(`Repaired ${label} JSON successfully.`);
      return result;
    } catch {
      onLog?.(`${label} JSON repair failed.`, "error");
      throw firstError instanceof Error
        ? firstError
        : new Error(`Failed to parse generated ${label} JSON.`);
    }
  }
}

async function requestJson(
  client: ReturnType<typeof getLlmClient>,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onLog?: (message: string, level?: JobLogLevel) => void,
  label = "generate",
  timeoutMs = getLlmTimeoutMs(),
): Promise<string> {
  const started = Date.now();
  const timeoutSec = Math.round(timeoutMs / 1000);
  onLog?.(`OpenRouter ${label} request started (${timeoutSec}s limit)…`);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages,
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (err) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (isAbortError(err)) {
      const message = `OpenRouter ${label} timed out after ${elapsed}s (limit ${timeoutSec}s). Please retry — the same model will be used.`;
      onLog?.(message, "error");
      throw new Error(message);
    }
    const message =
      err instanceof Error ? err.message : "OpenRouter request failed.";
    onLog?.(`OpenRouter ${label} failed after ${elapsed}s: ${message}`, "error");
    throw err instanceof Error ? err : new Error(message);
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  const content = completion.choices[0]?.message?.content;
  if (!content?.trim()) {
    onLog?.(
      `OpenRouter ${label} returned empty response after ${durationSec}s.`,
      "error",
    );
    throw new Error(`Empty response while generating ${label}.`);
  }

  onLog?.(
    `OpenRouter ${label} finished in ${durationSec}s (${content.length.toLocaleString()} chars).`,
  );
  return content;
}

function normalizeSkills(
  skills: unknown,
  extracted: ExtractedJD,
): SkillGroup[] {
  if (Array.isArray(skills) && skills.length) {
    if (
      typeof skills[0] === "object" &&
      skills[0] !== null &&
      "category" in (skills[0] as object)
    ) {
      return (skills as Array<{ category?: unknown; items?: unknown }>)
        .map((group) => ({
          category: sanitizePlainText(String(group.category || "Skills")),
          items: Array.isArray(group.items)
            ? group.items
                .map(String)
                .map((s) => sanitizePlainText(s))
                .filter(Boolean)
            : [],
        }))
        .filter((group) => group.items.length > 0);
    }

    const items = skills
      .map(String)
      .map((s) => sanitizePlainText(s))
      .filter(Boolean);
    if (items.length) {
      return [{ category: "Technical Skills", items }];
    }
  }

  const fallback = extracted.hardTechnicalSkills.filter(Boolean);
  if (!fallback.length) {
    return [
      {
        category: "Core",
        items: ["Software Engineering", "System Design", "Agile Delivery"],
      },
    ];
  }

  return [
    {
      category: "Technical Skills",
      items: fallback,
    },
  ];
}

function normalizeResume(
  resume: TailoredResume | undefined,
  profile: CandidateProfile,
  extracted: ExtractedJD,
): TailoredResume {
  const safe = resume || {
    summary: "",
    skills: [],
    experiences: [],
    education: [],
    keywords: [],
  };

  const skillGroups = normalizeSkills(safe.skills, extracted);

  const keywords = Array.from(
    new Set(
      [
        ...(safe.keywords || []),
        ...skillGroups.flatMap((g) => g.items),
        ...extracted.hardTechnicalSkills,
        ...extracted.softSkills,
        extracted.jobTitle,
        extracted.type,
        extracted.workMode,
      ]
        .map((k) => String(k).trim())
        .filter(Boolean),
    ),
  );

  const experiences = profile.experiences.map((exp, index) => {
    const generated = safe.experiences?.[index];
    let bullets = dedupeBullets(
      (generated?.bullets || [])
        .map(String)
        .map((b) => sanitizePlainText(b))
        .filter(Boolean),
    );

    let slot = 0;
    while (bullets.length < 7) {
      bullets = dedupeBullets([
        ...bullets,
        buildFillerBullet(exp.company, extracted.hardTechnicalSkills, slot),
      ]);
      slot += 1;
    }
    bullets = bullets.slice(0, 8);

    const overview = sanitizePlainText(
      String(
        generated && "overview" in generated
          ? (generated as { overview?: string }).overview || ""
          : "",
      ),
    );

    return {
      company: exp.company,
      title: tailorExperienceTitle(
        exp.title,
        extracted.type,
        extracted.jobTitle,
      ),
      period: exp.period,
      location: exp.location,
      overview:
        overview ||
        `${exp.company} team delivering software products in a ${exp.location.toLowerCase()} setting; served as ${exp.title} owning delivery of key features and technical outcomes aligned to business needs.`,
      bullets,
    };
  });

  const summary = sanitizePlainText(String(safe.summary || ""));

  return {
    summary: summary || buildFallbackSummary(profile, extracted),
    skills: skillGroups,
    experiences,
    education:
      Array.isArray(safe.education) && safe.education.length
        ? safe.education.map((edu) => ({
            school: sanitizePlainText(edu.school),
            degree: sanitizePlainText(edu.degree),
            period: sanitizePlainText(edu.period),
            location: sanitizePlainText(edu.location),
          }))
        : profile.education,
    keywords: keywords.map((k) => sanitizePlainText(k)).filter(Boolean),
  };
}
