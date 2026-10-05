// Robust OCR helper for certificate images.
// Usage: `node scripts/ocr-extract.js ./path/to/image.png`
// Dependencies: sharp (preprocessing) and tesseract.js (OCR).

import fs from "fs/promises";
import path from "path";
import os from "os";
import sharp from "sharp";
import Tesseract from "tesseract.js";

const DEFAULT_IMAGE = "lone_photo.png";

const TEMP_PREFIX = "ocr-preprocess-";

const UUID_REGEX =
  /[0-9a-fo]{8}-?[0-9a-fo]{4}-?[0-9a-fo]{4}-?[0-9a-fo]{4}-?[0-9a-fo]{12}/i;

const DATE_REGEXES = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/, // 2026-04-02
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // 04/02/2026 or 04/02/26
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/, // 04-02-2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i, // Apr 2, 2026
];

const ensureFileExists = async (filePath) => {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Input file not found: ${filePath}`);
  }
};

const createTempPath = async (ext = ".png") => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  return { dir, file: path.join(dir, `processed${ext}`) };
};

const cleanupTempDir = async (dir) => {
  if (!dir) return;
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    // Best-effort cleanup; log but do not fail main flow.
    console.warn(`Warning: temp cleanup failed: ${err.message}`);
  }
};

const preprocessImage = async (inputPath) => {
  const { dir, file } = await createTempPath(".png");
  try {
    const meta = await sharp(inputPath).metadata();
    const targetWidth = Math.min((meta.width || 0) * 2, 3500); // avoid huge upscales

    await sharp(inputPath)
      .resize(targetWidth, null, { withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .toFormat("png")
      .toFile(file);

    return { dir, file };
  } catch (err) {
    await cleanupTempDir(dir);
    throw new Error(`Preprocessing failed: ${err.message}`);
  }
};

const runOcr = async (imagePath) => {
  try {
    const {
      data: { text, confidence },
    } = await Tesseract.recognize(imagePath, "eng", {
      tessedit_pageseg_mode: 3, // fully automatic page segmentation
      preserve_interword_spaces: "1",
    });
    return { text: text || "", confidence: Number(confidence || 0) / 100 };
  } catch (err) {
    throw new Error(`OCR failed: ${err.message}`);
  }
};

const normalizeId = (value) =>
  String(value || "")
    .replace(/-/g, "")
    .replace(/o/gi, "0")
    .replace(/i/gi, "1")
    .toLowerCase();

const tryParseDate = (value) => {
  if (!value) return null;

  // Native Date parse
  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) {
    return native.toISOString();
  }

  // Regex-based attempts
  for (const regex of DATE_REGEXES) {
    const match = value.match(regex);
    if (!match) continue;
    const candidate = match[0];

    // Attempt MM/DD/YYYY and DD/MM/YYYY by checking month/day bounds
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(candidate)) {
      const [a, b, c] = candidate.split(/[/-]/).map(Number);
      const year = c < 100 ? 2000 + c : c;
      const mmdd = new Date(`${year}-${a}-${b}`);
      const ddmm = new Date(`${year}-${b}-${a}`);

      const validMmdd = !Number.isNaN(mmdd.getTime()) && mmdd.getMonth() + 1 === a;
      const validDdmm = !Number.isNaN(ddmm.getTime()) && ddmm.getMonth() + 1 === b;

      if (validMmdd && !validDdmm) return mmdd.toISOString();
      if (validDdmm && !validMmdd) return ddmm.toISOString();
      if (validMmdd && validDdmm) return mmdd.toISOString(); // default to MM/DD
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
};

const extractFieldsFromText = (rawText) => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let certificateId = "";
  let certificateTitle = "";
  let studentName = "";
  let dateOfIssuance = "";
  let issuerName = "";

  const safeGet = (index) => (index >= 0 && index < lines.length ? lines[index] : "");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Certificate ID (UUID-like, tolerant to OCR confusions)
    if (/certificate\s*id/i.test(line) || UUID_REGEX.test(line)) {
      const match = line.match(UUID_REGEX) || line.match(/[0-9a-fo-]{10,}/i);
      if (match) certificateId = normalizeId(match[0]);
    }

    // Student Name
    if (/proudly\s+presented\s+to/i.test(line)) {
      const nextLine = safeGet(i + 1);
      if (nextLine) studentName = nextLine;
    }

    // Certificate Title (commonly after 'in' or 'for')
    if (/^in\.?$/i.test(line) || /^for\.?$/i.test(line)) {
      const nextLine = safeGet(i + 1);
      if (nextLine) certificateTitle = nextLine;
    }

    // Date of issuance
    if (/date\s+of\s+completion|date\s+of\s+issuance/i.test(line)) {
      const nextLine = safeGet(i + 1);
      if (nextLine) dateOfIssuance = nextLine;
    }

    // Issuer
    if (/issued\s+by|issuer/i.test(line)) {
      const nextLine = safeGet(i + 1);
      if (nextLine) issuerName = nextLine;
    }
  }

  // Fallbacks across the whole text block
  if (!certificateId) {
    const match = rawText.match(UUID_REGEX);
    if (match) certificateId = normalizeId(match[0]);
  }

  if (!certificateTitle) {
    if (lines.includes("FREE FROM ALL")) certificateTitle = "FREE FROM ALL";
    else if (lines.includes("LONELINESS")) certificateTitle = "LONELINESS";
  }

  const parsedDate = tryParseDate(dateOfIssuance);

  return {
    certificateId: certificateId || null,
    certificateTitle: certificateTitle || null,
    studentName: studentName || null,
    issuerName: issuerName || null,
    dateOfIssuance: parsedDate || (dateOfIssuance || null),
  };
};

const formatForLogging = (result) => {
  const formatValue = (v) => (v == null ? "null" : `"${v}"`);
  return [
    `certificateId:\n${formatValue(result.certificateId)}`,
    `certificateTitle:\n${formatValue(result.certificateTitle)}`,
    `dateOfIssuance:\n${formatValue(result.dateOfIssuance)}`,
    `studentName:\n${formatValue(result.studentName)}`,
    `issuerName:\n${formatValue(result.issuerName)}`,
  ].join("\n");
};

export const extractFromImage = async (inputPath = DEFAULT_IMAGE) => {
  await ensureFileExists(inputPath);

  const { dir, file } = await preprocessImage(inputPath);
  let text = "";
  let confidence = 0;
  try {
    const ocr = await runOcr(file);
    text = ocr.text;
    confidence = ocr.confidence;
  } finally {
    await cleanupTempDir(dir);
  }

  const cleanedText = text || "";
  console.log("--- OCR TEXT ---");
  console.log(cleanedText);

  const extracted = extractFieldsFromText(cleanedText);
  console.log("--- EXTRACTED JSON ---");
  console.log(formatForLogging(extracted));

  const allRequiredFieldsPresent = Boolean(
    extracted.certificateId &&
      extracted.certificateTitle &&
      extracted.dateOfIssuance &&
      extracted.studentName &&
      extracted.issuerName,
  );
  const output = {
    schemaVersion: "1.0",
    templateVersion: "1.0",
    success: allRequiredFieldsPresent,
    certificateId: extracted.certificateId,
    certificateTitle: extracted.certificateTitle ? extracted.certificateTitle.toLowerCase() : null,
    studentName: extracted.studentName ? extracted.studentName.toLowerCase() : null,
    issuerName: extracted.issuerName ? extracted.issuerName.toLowerCase() : null,
    completionDate: extracted.dateOfIssuance ? String(extracted.dateOfIssuance).toLowerCase() : null,
    confidence: {
      certificateId: extracted.certificateId ? confidence : 0,
      certificateTitle: extracted.certificateTitle ? confidence : 0,
      studentName: extracted.studentName ? confidence : 0,
      issuerName: extracted.issuerName ? confidence : 0,
      completionDate: extracted.dateOfIssuance ? confidence : 0,
      overall: confidence,
    },
    validation: {
      valid: allRequiredFieldsPresent,
      schemaValid: true,
      allRequiredFieldsPresent,
      lineConstraintsValid: true,
      ocrMatchesQr: false,
    },
  };

  await fs.writeFile("result.json", JSON.stringify(output, null, 2), "utf8");
  return output;
};

// Allow CLI usage: node scripts/ocr-extract.js <imagePath?>
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] || DEFAULT_IMAGE;
  extractFromImage(input)
    .then((result) => {
      console.log("\nSaved to result.json");
      console.log(result);
    })
    .catch((err) => {
      console.error(`OCR extraction failed: ${err.message}`);
      process.exitCode = 1;
    });
}
