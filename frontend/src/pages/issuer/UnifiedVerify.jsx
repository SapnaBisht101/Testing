import React, { useState, useRef, useEffect, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useNavigate } from "react-router-dom";
import {
  QrCode,
  Camera,
  Upload,
  FileText,
  User,
  BookOpen,
  Calendar,
  Building,
  ScanLine,
  ArrowLeft,
  XCircle,
  Printer,
  RefreshCcw,
  Shield,
  Info,
  Hash,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import jsQR from "jsqr";
import { useMessage } from "../GlobalMessageProvider";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min?url";
import { CERTIFICATE_TEMPLATE, CERTIFICATE_TEMPLATE_VERSION } from "../../config/certificateTemplate.js";
import { buildOcrResult } from "../../utils/ocrSchema.js";
import { validateOcrField } from "../../utils/ocrNormalization.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const API_BASE = "http://localhost:4000/certificates";

const STEP_LABELS = {
  ocr_verified: "OCR Verified",
  db_verified: "DB Verified",
  blockchain_verified: "Blockchain Verified",
};

const STATUS_LABELS = {
  VERIFIED: "Verified",
  BLOCKCHAIN_FAILED: "Blockchain Check Failed",
  QR_VERIFICATION_FAILED: "QR Verification Failed",
  CERTIFICATE_VERIFICATION_FAILED: "Certificate Verification Failed",
  ERROR: "Error",
  INVALID: "Invalid",
};

const TEMPLATE_OCR_REGIONS = Object.entries(CERTIFICATE_TEMPLATE.fields).map(([configuredKey, field]) => {
  const key = configuredKey === "certificateId" ? "qrCodeId" : configuredKey;
  return {
  ...field,
  key,
  label:
    key === "qrCodeId"
      ? "Certificate ID"
      : key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
  w: field.width,
  h: field.height,
  };
});

const OCR_FIELD_PASSES = [
  { name: "single_line", psm: "7" },
  { name: "uniform_block", psm: "6" },
  { name: "sparse_text", psm: "11" },
];

const OCR_DOCUMENT_PASSES = [
  { name: "uniform_block", psm: "6" },
  { name: "sparse_text", psm: "11" },
];

// OCR output is noisy, so normalize common scan mistakes before comparing it to QR data.
const normalizeValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const cleanOCR = (text) =>
  String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/¢/g, "c")
    .replace(/!/g, "1")
    .replace(/\b1D\b/g, "ID")
    .replace(/\b0F\b/gi, "OF")
    .replace(/\bT0\b/gi, "TO")
    .replace(/\bPR0UDLY\b/gi, "PROUDLY")
    .replace(/\bC0MPLETION\b/gi, "COMPLETION")
    .replace(/\[\d+\]/g, "")
    .replace(/[|—]/g, " ")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();

const cleanOCRLine = (text) =>
  String(text || "")
    .replace(/¢/g, "c")
    .replace(/!/g, "1")
    .replace(/\b1D\b/g, "ID")
    .replace(/\b0F\b/gi, "OF")
    .replace(/\bT0\b/gi, "TO")
    .replace(/\bPR0UDLY\b/gi, "PROUDLY")
    .replace(/\bC0MPLETION\b/gi, "COMPLETION")
    .replace(/\[\d+\]/g, "")
    .replace(/[|—]/g, " ")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeTextBlock = (value) =>
  normalizeValue(value)
    .replace(/[^a-z0-9@\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toNormalizedSearchToken = (value) => normalizeTextBlock(value);
const toCompactIdentifier = (value) => normalizeValue(value).replace(/[^a-z0-9]/g, "");
const toWordTokens = (value) => toNormalizedSearchToken(value).split(" ").filter(Boolean);
const stripCertificateIdLabel = (value) => String(value || "").replace(/certificate\s*id\s*:?\s*/i, "").trim();

const buildDateSearchTokens = (value) => {
  const normalizedRawValue = toNormalizedSearchToken(value);
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedRawValue ? [normalizedRawValue] : [];
  }

  const utcYear = parsedDate.getUTCFullYear();
  const utcMonth = parsedDate.getUTCMonth();
  const utcDay = parsedDate.getUTCDate();
  const utcDate = new Date(Date.UTC(utcYear, utcMonth, utcDay));

  return [
    normalizedRawValue,
    toNormalizedSearchToken(utcDate.toISOString().slice(0, 10)),
    toNormalizedSearchToken(
      utcDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }),
    ),
    toNormalizedSearchToken(
      utcDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        timeZone: "UTC",
      }),
    ),
  ].filter(Boolean);
};

const buildExpectedOcrSegments = (qrPayload = {}) =>
  [
    { key: "qrCodeId", label: "Certificate ID", value: qrPayload.qrCodeId, type: "id" },
    { key: "studentName", label: "Student Name", value: qrPayload.studentName, type: "text" },
    { key: "issuerName", label: "Issuer Name", value: qrPayload.issuerName, type: "text" },
    { key: "certificateTitle", label: "Certificate Title", value: qrPayload.certificateTitle, type: "text" },
    { key: "completionDate", label: "Date Of Issuance", value: qrPayload.completionDate, type: "date" },
  ].filter((segment) => segment.value);

const buildQrFieldLog = (qrPayload = {}) => ({
  certificateId: qrPayload.qrCodeId || "",
  studentName: qrPayload.studentName || "",
  issuerName: qrPayload.issuerName || "",
  certificateTitle: qrPayload.certificateTitle || "",
  dateOfIssuance: qrPayload.completionDate || "",
});

const buildOcrFieldLog = (ocrFields = {}) => ({
  certificateId: ocrFields.qrCodeId || "",
  studentName: ocrFields.studentName || "",
  issuerName: ocrFields.issuerName || "",
  certificateTitle: ocrFields.certificateTitle || "",
  dateOfIssuance: ocrFields.completionDate || "",
});

const buildNormalizedFieldLog = (fields = {}) => ({
  certificateId: toCompactIdentifier(fields.certificateId || ""),
  studentName: toNormalizedSearchToken(fields.studentName || ""),
  issuerName: toNormalizedSearchToken(fields.issuerName || ""),
  certificateTitle: toNormalizedSearchToken(fields.certificateTitle || ""),
  dateOfIssuance: buildDateSearchTokens(fields.dateOfIssuance || "")[0] || toNormalizedSearchToken(fields.dateOfIssuance || ""),
});

const buildFieldMatchLog = (segmentResults = []) =>
  Object.fromEntries(
    segmentResults.map((segment) => [
      segment.key,
      {
        label: segment.label,
        matched: segment.match.matched,
        strategy: segment.match.strategy,
        expected: segment.match.expected,
        matchedTokens: segment.match.matchedTokens || [],
      },
    ]),
  );

const formatFieldValue = (value) => {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || "Not detected";
};

const buildFieldCropCanvas = (sourceCanvas, region, options = {}) => {
  const { enhance = true, scale = 2 } = options;
  const sx = Math.max(0, Math.floor(sourceCanvas.width * region.x));
  const sy = Math.max(0, Math.floor(sourceCanvas.height * region.y));
  const sw = Math.max(1, Math.floor(sourceCanvas.width * region.w));
  const sh = Math.max(1, Math.floor(sourceCanvas.height * region.h));

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = sw * scale;
  targetCanvas.height = sh * scale;
  const targetContext = targetCanvas.getContext("2d");

  if (!targetContext) {
    throw new Error("Canvas cropping is unavailable in this browser.");
  }

  targetContext.fillStyle = "#ffffff";
  targetContext.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetCanvas.width, targetCanvas.height);

  if (!enhance) {
    return targetCanvas;
  }

  const imageData = targetContext.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const boosted = gray > 215 ? 255 : gray < 150 ? 0 : Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128));
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }
  targetContext.putImageData(imageData, 0, 0);

  return targetCanvas;
};

const buildDocumentOcrCanvas = (sourceCanvas, options = {}) => {
  const { scale = 1.6, enhance = true } = options;
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = Math.max(1, Math.floor(sourceCanvas.width * scale));
  targetCanvas.height = Math.max(1, Math.floor(sourceCanvas.height * scale));

  const targetContext = targetCanvas.getContext("2d");
  if (!targetContext) {
    throw new Error("Canvas preprocessing is unavailable in this browser.");
  }

  targetContext.fillStyle = "#ffffff";
  targetContext.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);

  if (!enhance) {
    return targetCanvas;
  }

  const imageData = targetContext.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const contrasted = gray > 210 ? 255 : gray < 130 ? 0 : Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  targetContext.putImageData(imageData, 0, 0);

  return targetCanvas;
};

const buildUniqueTextBlock = (...texts) =>
  [...new Set(texts.flatMap((text) => String(text || "").split(/\r?\n/).map(cleanOCRLine).filter(Boolean)))]
    .join("\n")
    .trim();

const levenshteinDistance = (a = "", b = "") => {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  const curr = new Array(t.length + 1);

  for (let i = 0; i < s.length; i += 1) {
    curr[0] = i + 1;
    for (let j = 0; j < t.length; j += 1) {
      const cost = s[i] === t[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        prev[j + 1] + 1, // deletion
        curr[j] + 1, // insertion
        prev[j] + cost, // substitution
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[t.length];
};

const scoreOcrCandidate = (segment, candidate) => {
  const match = matchExtractedField(segment, candidate);
  if (match.matched) {
    const strategyScores = {
      compact_id: 100,
      date_candidate: 96,
      exact_text: 92,
      fuzzy_id: 88,
      token_overlap: 84,
      date_tokens: 72,
      word_tokens: 64,
    };

    return (strategyScores[match.strategy] || 50) + (match.matchedTokens?.length || 0);
  }

  if (segment.type === "id") {
    const expectedId = toCompactIdentifier(segment.value);
    const actualId = toCompactIdentifier(candidate);
    if (!expectedId || !actualId) return 0;
    return [...expectedId].filter((char) => actualId.includes(char)).length;
  }

  const expectedTokens = segment.type === "date" ? buildDateSearchTokens(segment.value) : toWordTokens(segment.value);
  const candidateTokens = new Set(segment.type === "date" ? buildDateSearchTokens(candidate) : toWordTokens(candidate));
  return expectedTokens.filter((token) => candidateTokens.has(token)).length;
};

const matchExtractedField = (segment, ocrValue) => {
  const normalizedOcrValue = toNormalizedSearchToken(ocrValue);
  const ocrWordSet = new Set(toWordTokens(ocrValue));

  if (segment.type === "id") {
    const compactExpectedId = toCompactIdentifier(segment.value);
    const compactOcrValue = toCompactIdentifier(stripCertificateIdLabel(ocrValue));
    if (Boolean(compactExpectedId) && compactOcrValue.includes(compactExpectedId)) {
      return {
        matched: true,
        strategy: "compact_id",
        expected: compactExpectedId,
        actual: compactOcrValue,
      };
    }

    // Allow small OCR errors (e.g., O/0 or 1/I) via Levenshtein distance threshold.
    if (compactExpectedId && compactOcrValue && Math.abs(compactExpectedId.length - compactOcrValue.length) <= 2) {
      const distance = levenshteinDistance(compactExpectedId, compactOcrValue);
      if (distance <= 2) {
        return {
          matched: true,
          strategy: "fuzzy_id",
          expected: compactExpectedId,
          actual: compactOcrValue,
          distance,
        };
      }
    }

    return {
      matched: false,
      strategy: "compact_id",
      expected: compactExpectedId,
      actual: compactOcrValue,
    };
  }

  if (segment.type === "date") {
    const dateCandidates = buildDateSearchTokens(segment.value);
    const ocrDateCandidates = buildDateSearchTokens(ocrValue);
    const exactDateMatch = dateCandidates.find((candidate) => ocrDateCandidates.includes(candidate));

    if (exactDateMatch) {
      return { matched: true, strategy: "date_candidate", expected: exactDateMatch, actual: ocrDateCandidates };
    }

    const dateTokens = dateCandidates
      .flatMap((candidate) => candidate.split(" "))
      .filter((token) => token.length > 1);
    const uniqueDateTokens = [...new Set(dateTokens)];
    const matchedDateTokens = uniqueDateTokens.filter((token) => ocrWordSet.has(token));

      return {
        matched: uniqueDateTokens.length > 0 && matchedDateTokens.length >= Math.min(3, uniqueDateTokens.length),
        strategy: "date_tokens",
        expected: dateCandidates,
        actual: ocrDateCandidates,
        matchedTokens: matchedDateTokens,
      };
  }

  const normalizedValue = toNormalizedSearchToken(segment.value);
  if (normalizedValue && normalizedOcrValue.includes(normalizedValue)) {
    return { matched: true, strategy: "exact_text", expected: normalizedValue, actual: normalizedOcrValue };
  }

  const expectedTokens = toWordTokens(segment.value).filter((token) => token.length > 1);
  const matchedTokens = expectedTokens.filter((token) => ocrWordSet.has(token));

  // Treat as match when we see >=60% of the expected tokens (helps with minor OCR drop/mis-ordering).
  const overlapRatio = expectedTokens.length > 0 ? matchedTokens.length / expectedTokens.length : 0;
  if (expectedTokens.length > 0 && overlapRatio >= 0.6) {
    return {
      matched: true,
      strategy: "token_overlap",
      expected: expectedTokens,
      actual: normalizedOcrValue,
      matchedTokens,
    };
  }

  return {
    matched: expectedTokens.length > 0 && matchedTokens.length === expectedTokens.length,
    strategy: "word_tokens",
    expected: expectedTokens,
    actual: normalizedOcrValue,
    matchedTokens,
  };
};

const matchSegmentWithFallback = (segment, extractedValue, rawText = "") => {
  const fieldMatch = matchExtractedField(segment, extractedValue || "");
  if (fieldMatch.matched) {
    return { ...fieldMatch, source: "field_crop" };
  }

  const cleanedRawText = cleanOCR(rawText);
  if (cleanedRawText) {
    const fullTextMatch = matchExtractedField(segment, cleanedRawText);
    if (fullTextMatch.matched) {
      return { ...fullTextMatch, source: "full_ocr_text" };
    }
  }

  return { ...fieldMatch, source: "field_crop" };
};
// QR uploads may contain either the raw ID or the full JSON payload.
const parseQrPayload = (rawData) => {
  if (!rawData || typeof rawData !== "string") {
    return { qrCodeId: "", payload: null };
  }

  try {
    const parsed = JSON.parse(rawData);
    return {
      qrCodeId: String(parsed?.qrCodeId || "").trim(),
      payload: parsed,
    };
  } catch {
    const trimmed = rawData.trim();
    return {
      qrCodeId: trimmed,
      payload: { qrCodeId: trimmed },
    };
  }
};

// PDF verification works by rendering each page to an image and reusing that image for both QR scanning and OCR.
const renderPdfPageToCanvas = async (page, scale = 2.5) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("PDF rendering is unavailable in this browser.");
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;

  return { canvas, context };
};

export default function UnifiedVerify() {
  const { showMessage } = useMessage();
  const navigate = useNavigate();
  // Shared verification state drives the progress panel and result card across all modes.
  const [mode, setMode] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Authenticating...");
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState("");
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [verificationDetails, setVerificationDetails] = useState(null);
  const [verificationSteps, setVerificationSteps] = useState([]);
  const [scanProgress, setScanProgress] = useState("");
  const [pdfInfo, setPdfInfo] = useState(null);
  const videoRef = useRef(null);
  const manualInputRef = useRef(null);

  const resetVerificationState = useCallback(() => {
    setCertificate(null);
    setError("");
    setVerificationStatus(null);
    setVerificationDetails(null);
    setVerificationSteps([]);
  }, []);

  // A simple black-and-white fallback makes low-contrast QR codes easier to decode.
  const preprocessImage = useCallback((imageData) => {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const value = gray > 128 ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    return { data, width: imageData.width, height: imageData.height };
  }, []);

  const decodeQrFromImageData = useCallback(
    (imageData) => {
      const attempts = [imageData, preprocessImage(imageData)];
      const inversionModes = ["dontInvert", "attemptBoth", "invertFirst"];
      for (const candidate of attempts) {
        for (const inversionMode of inversionModes) {
          const code = jsQR(candidate.data, candidate.width, candidate.height, {
            inversionAttempts: inversionMode,
          });
          if (code?.data) return code.data;
        }
      }
      return null;
    },
    [preprocessImage],
  );

  const applyVerificationResult = useCallback(
    (data, successMessage) => {
      const blockchainError = data?.blockchainError || data?.blockchainMessage;
      const combinedMessage = blockchainError || data?.message;
      const steps = data.steps || [];
      const allStepsPassed =
        steps.length > 0 ? steps.every((step) => step.name === "ocr_verified" || step.passed !== false) : false;
      const resolvedValid = data.valid || allStepsPassed;
      const resolvedStatus =
        data.status || (blockchainError ? "BLOCKCHAIN_FAILED" : resolvedValid ? "VERIFIED" : "INVALID");
      setError("");
      setVerificationSteps(steps);
      setVerificationDetails({ ...data, steps, valid: resolvedValid, status: resolvedStatus });
      setVerificationStatus(resolvedStatus);
      if (resolvedValid && data.data) {
        setCertificate(data.data);
        showMessage(successMessage, "success");
        return;
      }
      setCertificate(data.data || null);
      setError(combinedMessage || "Verification failed.");
      showMessage(combinedMessage || "Verification failed.", "error");
    },
    [showMessage],
  );

const mergeVerificationResult = useCallback(
  (initialSteps, data, successMessage) => {
      const blockchainError = data?.blockchainError || data?.blockchainMessage;
      const combinedMessage = blockchainError || data?.message;
    const serverSteps = (data.steps || []).filter(
      (serverStep) => !initialSteps.some((initialStep) => initialStep.name === serverStep.name),
    );
    const mergedSteps = [...initialSteps, ...serverSteps];
    const allStepsPassed =
      mergedSteps.length > 0 ? mergedSteps.every((step) => step.name === "ocr_verified" || step.passed !== false) : false;
    const resolvedValid = data.valid || allStepsPassed;
    setError("");
    setVerificationSteps(mergedSteps);
    const resolvedStatus =
      data.status || (blockchainError ? "BLOCKCHAIN_FAILED" : resolvedValid ? "VERIFIED" : "INVALID");
    setVerificationDetails({ ...data, steps: mergedSteps, valid: resolvedValid, status: resolvedStatus });
    setVerificationStatus(resolvedStatus);

    if (resolvedValid && data.data) {
        setCertificate(data.data);
        showMessage(successMessage, "success");
        return;
    }

    setCertificate(data.data || null);
    setError(combinedMessage || "Verification failed.");
    showMessage(combinedMessage || "Verification failed.", "error");
  },
  [showMessage],
);

const postVerification = useCallback(
    async (path, body, successMessage) => {
      setLoading(true);
      resetVerificationState();
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error("Invalid server response.");
        }

        if (!res.ok && !data?.message) {
          throw new Error(`Verification request failed with status ${res.status}.`);
        }

        applyVerificationResult(data, successMessage);
      } catch (err) {
        setError(err.message || "Network error. Connection to verification server failed.");
        setVerificationStatus("ERROR");
        showMessage(err.message || "Network or server error. Could not verify.", "error");
      } finally {
        setLoading(false);
        setScanProgress("");
      }
    },
    [applyVerificationResult, resetVerificationState, showMessage],
  );

  const postVerificationWithSteps = useCallback(
    async (path, body, initialSteps, successMessage) => {
      setLoading(true);
      resetVerificationState();
      setVerificationSteps(initialSteps);
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error("Invalid server response.");
        }

        if (!res.ok && !data?.message) {
          throw new Error(`Verification request failed with status ${res.status}.`);
        }

        mergeVerificationResult(initialSteps, data, successMessage);
      } catch (err) {
        setError(err.message || "Network error. Connection to verification server failed.");
        setVerificationStatus("ERROR");
        setVerificationDetails({ steps: initialSteps });
        showMessage(err.message || "Network or server error. Could not verify.", "error");
      } finally {
        setLoading(false);
        setScanProgress("");
      }
    },
    [mergeVerificationResult, resetVerificationState, showMessage],
  );

  const verifyManual = useCallback(
    async (manualInput) => {
      if (!manualInput?.trim()) {
        setError("Enter a QR ID, QR payload, or certificate hash.");
        showMessage("Manual input is required.", "error");
        return;
      }
      setLoadingLabel("Running direct blockchain verification...");
      await postVerification("/verify-manual", { manualInput }, "Blockchain verification successful.");
    },
    [postVerification, showMessage],
  );

  const verifyQrOnly = useCallback(
    async (qrData) => {
      const parsed = parseQrPayload(qrData);
      if (!parsed.qrCodeId) {
        setError("QR Code ID is missing or unreadable.");
        showMessage("Invalid or unreadable QR code.", "error");
        return;
      }
      setLoadingLabel("Running blockchain check (DB record will be shown if found)...");
      await postVerification("/verify-qr", { qrData }, "QR verification successful.");
    },
    [postVerification, showMessage],
  );

  const verifyOcrLocally = useCallback((qrData, ocrFields = {}, rawText = "") => {
    const parsed = parseQrPayload(qrData);
    const qrPayload = parsed.payload || {};
    const cleanedText = cleanOCR(rawText);
    const expectedSegments = buildExpectedOcrSegments(qrPayload);
    console.log("[VERIFY][OCR_RAW_TEXT]", cleanedText || "No OCR text extracted");
    console.log("[VERIFY][QR_FIELDS]", buildNormalizedFieldLog(buildQrFieldLog(qrPayload)));
    console.log("[VERIFY][OCR_FIELDS]", buildNormalizedFieldLog(buildOcrFieldLog(ocrFields)));
    const segmentResults = expectedSegments.map((segment) => ({
      ...segment,
      extractedValue: ocrFields[segment.key] || "",
      match: matchSegmentWithFallback(segment, ocrFields[segment.key] || "", rawText),
    }));
    console.log("[VERIFY][FIELD_MATCHES]", buildFieldMatchLog(segmentResults));
    const missingSegments = segmentResults
      .filter((segment) => !segment.match.matched)
      .map((segment) => segment.label);

    return {
      name: "ocr_verified",
      label: "OCR Verified",
      passed: missingSegments.length === 0,
      message:
        missingSegments.length === 0
          ? "Certificate ID matched between QR and OCR."
          : "Certificate ID could not be matched between QR and OCR.",
      details: {
        expectedSegments: segmentResults.map(({ key, label, value, type, extractedValue, match }) => ({
          key,
          label,
          value,
          type,
          extractedValue,
          match,
        })),
        missingSegments,
        rawOcrText: cleanedText,
        ignoredVisualElements: ["signatureImage", "institutionLogo"],
      },
    };
  }, []);

  const verifyCompleteCertificate = useCallback(
    async ({ qrData, ocrFields, rawText, structuredResult }) => {
      const parsed = parseQrPayload(qrData);
      if (!parsed.qrCodeId) {
        setError("Certificate QR is missing or unreadable.");
        showMessage("Certificate QR is missing or unreadable.", "error");
        return;
      }

      const fieldValues = Object.fromEntries(
        Object.entries(ocrFields || {}).map(([key, field]) => [key, field?.value ?? field ?? ""]),
      );
      const ocrStep = verifyOcrLocally(qrData, fieldValues, rawText);
      setLoadingLabel("Running OCR and blockchain check (DB record will be shown if found)...");
      await postVerificationWithSteps(
        "/verify-certificate",
        {
          qrData,
          rawText,
          ocrFields: Object.fromEntries(
            Object.entries(fieldValues).map(([key, value]) => [key, value || null]),
          ),
          ocrMetadata: {
            schemaVersion: "1.0",
            templateVersion: CERTIFICATE_TEMPLATE_VERSION,
            overallConfidence: structuredResult?.confidence?.overall || 0,
          },
          ocrValidation: structuredResult?.validation || null,
        },
        [ocrStep],
        "Certificate verification successful.",
      );
    },
    [postVerificationWithSteps, resetVerificationState, showMessage, verifyOcrLocally],
  );

  const runImageOcr = useCallback(async (source, progressLabel = "image", config = {}) => {
    const { default: Tesseract } = await import("tesseract.js");
    const result = await Tesseract.recognize(source, "eng", {
      preserve_interword_spaces: "1",
      ...config,
      logger: ({ status }) => {
        if (status) setScanProgress(`OCR (${progressLabel}): ${status}`);
      },
    });

    return {
      text: result.data?.text || "",
      confidence: Number.isFinite(result.data?.confidence) ? result.data.confidence / 100 : 0,
    };
  }, []);

  const runFullDocumentOcr = useCallback(
    async (canvas, progressLabel = "certificate", expectedPayload = {}) => {
      const variants = [
        { name: "enhanced", canvas: buildDocumentOcrCanvas(canvas, { enhance: true }) },
        { name: "original", canvas: buildDocumentOcrCanvas(canvas, { enhance: false }) },
      ];

      let bestCandidate = "";
      let bestScore = -1;
      const allCandidates = [];
      const expectedSegments = buildExpectedOcrSegments(expectedPayload);

      for (const variant of variants) {
        for (const pass of OCR_DOCUMENT_PASSES) {
          setScanProgress(`OCR (${progressLabel}): full document ${variant.name} ${pass.name}`);
          const ocrResult = await runImageOcr(variant.canvas, `${progressLabel} full document ${variant.name} ${pass.name}`, {
            tessedit_pageseg_mode: pass.psm,
          });
          const rawText = ocrResult.text;
          const cleanedText = cleanOCR(rawText);
          allCandidates.push(cleanedText);
          const candidateScore =
            expectedSegments.reduce((total, segment) => total + scoreOcrCandidate(segment, cleanedText), 0) +
            cleanedText.length / 500;

          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            bestCandidate = cleanedText;
          }
        }
      }

      if (!bestCandidate) {
        bestCandidate = allCandidates.sort((a, b) => b.length - a.length)[0] || "";
      }

      return bestCandidate;
    },
    [runImageOcr],
  );

  const runTemplateFieldOcr = useCallback(
    async (canvas, expectedPayload = {}, progressLabel = "certificate") => {
      const fieldValues = {};
      const fieldDebug = {};
      const expectedSegments = buildExpectedOcrSegments(expectedPayload);

      for (const region of TEMPLATE_OCR_REGIONS) {
        const segment = expectedSegments.find((item) => item.key === region.key);
        if (!segment) {
          continue; // Skip regions we don't need (only Certificate ID now).
        }
        const fieldVariants = [
          { name: "enhanced", canvas: buildFieldCropCanvas(canvas, region, { enhance: true }) },
          { name: "original", canvas: buildFieldCropCanvas(canvas, region, { enhance: false }) },
        ];

        let bestText = "";
        let bestScore = -1;
        let bestMeta = null;

        for (const variant of fieldVariants) {
          for (const pass of OCR_FIELD_PASSES) {
            setScanProgress(`OCR (${progressLabel}): ${region.label} ${variant.name} ${pass.name}`);
            const ocrResult = await runImageOcr(variant.canvas, `${progressLabel} ${region.label} ${variant.name} ${pass.name}`, {
              tessedit_pageseg_mode: pass.psm || region.psm,
            });
            const rawFieldText = ocrResult.text;
            const cleanedFieldText = cleanOCRLine(stripCertificateIdLabel(rawFieldText));
            const candidateScore = segment
              ? scoreOcrCandidate(segment, cleanedFieldText) + ocrResult.confidence
              : ocrResult.confidence;

            if (candidateScore > bestScore) {
              bestScore = candidateScore;
              bestText = cleanedFieldText;
              bestMeta = {
                variant: variant.name,
                pass: pass.name,
                psm: pass.psm || region.psm,
                score: candidateScore,
              };
            }
          }
        }

        const validation = validateOcrField(bestText, region);
        fieldValues[region.key] = {
          value: validation.value,
          rawValue: bestText,
          confidence: Math.max(0, Math.min(1, bestScore > 0 ? Math.min(1, bestScore / 100) : 0)),
          accepted: validation.valid,
          valid: validation.valid,
          lineConstraintsValid: !validation.errors.includes("OCR_LINE_LIMIT_EXCEEDED"),
          errors: validation.errors,
          linesDetected: validation.linesDetected,
        };
        fieldDebug[region.key] = {
          label: region.label,
          selected: bestMeta,
          value: bestText,
          validation,
        };
      }

      return { fieldValues, fieldDebug };
    },
    [runImageOcr],
  );

  const extractCertificateOcr = useCallback(
    async (canvas, qrData, progressLabel = "certificate") => {
      const qrPayload = parseQrPayload(qrData).payload || {};
      const [{ fieldValues, fieldDebug }, fullDocumentText] = await Promise.all([
        runTemplateFieldOcr(canvas, qrPayload, progressLabel),
        runFullDocumentOcr(canvas, progressLabel, qrPayload),
      ]);
      const rawText = buildUniqueTextBlock(
        fullDocumentText,
        ...Object.values(fieldValues).map((field) => field.rawValue),
      );
      const ocrResult = buildOcrResult({
        fields: fieldValues,
        rawText,
        templateVersion: CERTIFICATE_TEMPLATE_VERSION,
      });

      console.log(`[OCR][${progressLabel}][raw_text]`, rawText || "No OCR text extracted");
      console.log(`[OCR][${progressLabel}][fields]`, fieldValues);
      console.log(`[OCR][${progressLabel}][selection]`, fieldDebug);

      return {
        ocrFields: {
          ...fieldValues,
          certificateId: fieldValues.qrCodeId,
        },
        structuredResult: ocrResult,
        rawText,
        fullDocumentText,
        fieldDebug,
      };
    },
    [runFullDocumentOcr, runTemplateFieldOcr],
  );

  const processQrImage = useCallback(
    async (file) => {
      if (!file?.type.startsWith("image/")) {
        setError("Please upload a valid image file.");
        showMessage("Please upload a valid image file.", "error");
        return;
      }

      setLoading(true);
      setLoadingLabel("Reading QR image...");
      resetVerificationState();

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;

      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setError("Image processing is unavailable in this browser.");
          setLoading(false);
          URL.revokeObjectURL(objectUrl);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrData = decodeQrFromImageData(imageData);
        console.log("[QR][qrImage]", qrData || "No QR detected");

        URL.revokeObjectURL(objectUrl);
        setLoading(false);

        if (!qrData) {
          setError("No valid QR code found in image.");
          showMessage("No QR code detected in the image.", "error");
          return;
        }

        await verifyQrOnly(qrData);
      };

      img.onerror = () => {
        setError("Image load failed.");
        showMessage("Failed to load image.", "error");
        setLoading(false);
        URL.revokeObjectURL(objectUrl);
      };
    },
    [decodeQrFromImageData, resetVerificationState, showMessage, verifyQrOnly],
  );

  const processCertificateImage = useCallback(
    async (file) => {
      if (!file?.type.startsWith("image/")) {
        setError("Please upload a valid image file.");
        showMessage("Please upload a valid image file.", "error");
        return;
      }

      setLoading(true);
      setLoadingLabel("Extracting QR and OCR text from certificate image...");
      resetVerificationState();

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;

      img.onload = async () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Image processing is unavailable in this browser.");

          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qrData = decodeQrFromImageData(imageData);
          console.log("[QR][certificateImage]", qrData || "No QR detected");

          if (!qrData) throw new Error("No QR code detected in the certificate image.");

          const { ocrFields, rawText, structuredResult } = await extractCertificateOcr(
            canvas,
            qrData,
            "certificateImage",
          );
          URL.revokeObjectURL(objectUrl);
          setLoading(false);
          await verifyCompleteCertificate({ qrData, ocrFields, rawText, structuredResult });
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          setLoading(false);
          setError(err.message || "Failed to process certificate image.");
          showMessage(err.message || "Failed to process certificate image.", "error");
        }
      };

      img.onerror = () => {
        setError("Image load failed.");
        showMessage("Failed to load image.", "error");
        setLoading(false);
        URL.revokeObjectURL(objectUrl);
      };
    },
    [decodeQrFromImageData, extractCertificateOcr, resetVerificationState, showMessage, verifyCompleteCertificate],
  );

  const processCertificatePdf = useCallback(
    async (file) => {
      if (file?.type !== "application/pdf") {
        setError("Please upload a valid PDF file.");
        showMessage("Please upload a valid PDF file.", "error");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("PDF file is too large. Maximum size is 10MB.");
        showMessage("PDF file is too large.", "error");
        return;
      }

      setLoading(true);
      setLoadingLabel("Extracting QR and text from PDF certificate...");
      resetVerificationState();
      setPdfInfo(null);
      setScanProgress("");

      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfInfo({
          name: file.name,
          pages: pdf.numPages,
          size: `${(file.size / 1024).toFixed(2)} KB`,
        });

        let ocrFields = null;
        let rawText = "";
        let qrData = null;
        let structuredResult = null;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          setScanProgress(`Rendering page ${pageNum} of ${pdf.numPages}...`);
          const page = await pdf.getPage(pageNum);
          const { canvas, context } = await renderPdfPageToCanvas(page);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

          if (!qrData) {
            setScanProgress(`Scanning page ${pageNum} of ${pdf.numPages} for QR...`);
            qrData = decodeQrFromImageData(imageData);
          }

          if (qrData) {
            const extraction = await extractCertificateOcr(canvas, qrData, `certificatePdf page ${pageNum}`);
            ocrFields = extraction.ocrFields;
            rawText = extraction.rawText;
            structuredResult = extraction.structuredResult;
            break;
          }
        }

        if (!qrData) throw new Error("No QR code detected in the PDF certificate.");
        console.log("[QR][certificatePdf][final]", qrData);
        console.log("[OCR][certificatePdf][final]", ocrFields);
        console.log("[OCR][certificatePdf][raw_text]", rawText || "No OCR text extracted");
        if (!ocrFields || !rawText) {
          throw new Error("No OCR text could be extracted from the PDF certificate.");
        }

        setLoading(false);
        await verifyCompleteCertificate({ qrData, ocrFields, rawText, structuredResult });
      } catch (err) {
        setLoading(false);
        setError(err.message || "Failed to process the PDF document.");
        showMessage(err.message || "Failed to process the PDF document.", "error");
      } finally {
        setScanProgress("");
      }
    },
    [decodeQrFromImageData, extractCertificateOcr, resetVerificationState, showMessage, verifyCompleteCertificate],
  );

  useEffect(() => {
    if (mode !== "qrLive") return;
    const reader = new BrowserMultiFormatReader();
    let controls = null;
    reader
      .decodeFromVideoDevice(null, videoRef.current, async (result) => {
        if (result) {
          controls?.stop();
          setMode("idle");
          await verifyQrOnly(result.getText());
        }
      })
      .catch(() => {
        setError("Camera access denied or unavailable.");
        showMessage("Camera unavailable or permission denied.", "error");
        setMode("idle");
      })
      .then((c) => {
        controls = c;
      });
    return () => controls?.stop();
  }, [mode, showMessage, verifyQrOnly]);

  const groupedModes = [
    {
      label: "Manual",
      items: [{ icon: ScanLine, title: "Manual QR", activeMode: "manual", short: "Blockchain only" }],
    },
    {
      label: "QR Only",
      items: [
        { icon: Camera, title: "Live QR Scan", activeMode: "qrLive", short: "QR -> DB -> chain" },
        { icon: Upload, title: "QR Image", activeMode: "qrImage", short: "QR image" },
      ],
    },
    {
      label: "Complete Certificate",
      items: [
        { icon: Upload, title: "Certificate Image", activeMode: "certificateImage", short: "Image OCR" },
        { icon: FileText, title: "Certificate PDF", activeMode: "certificatePdf", short: "PDF OCR" },
      ],
    },
  ];

  const SidebarItem = ({ icon: Icon, title, activeMode, short }) => (
    <button
      onClick={() => {
        setMode(activeMode);
        resetVerificationState();
        setScanProgress("");
        setPdfInfo(null);
      }}
      className={`group w-full rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ${
        mode === activeMode
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-600"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
            mode === activeMode
              ? "border-blue-200 bg-white text-blue-600"
              : "border-gray-200 bg-gray-50 text-gray-500 group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600"
          }`}
        >
          <Icon size={18} strokeWidth={mode === activeMode ? 2.4 : 2} />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="text-xs text-gray-400 group-hover:text-blue-500">{short}</p>
        </div>
      </div>
    </button>
  );

  const statusTone = error
    ? "border-red-200 bg-red-50 text-red-600"
    : "border-emerald-200 bg-emerald-50 text-emerald-600";

  return (
    <div
      className="min-h-screen w-full bg-white text-gray-900"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <aside className="fixed left-0 top-0 z-20 flex h-full w-72 flex-col border-r border-gray-200 bg-white">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg">
              <img src="/pnglogo.png" alt="DECIVE" className="h-full w-full object-contain" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-blue-600">DECIVE</span>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {groupedModes.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <SidebarItem key={item.activeMode} {...item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              <Shield size={14} />
              Security Active
            </div>
            <p className="text-sm leading-6 text-gray-600">
              Every verification path returns explicit step status so you can see where tampering happened.
            </p>
          </div>
        </div>
      </aside>

      <div className="ml-72 min-h-screen">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-xl">
          <div className="flex items-center justify-between px-8 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Verification Workspace
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-blue-600">
                Unified Verify
              </h1>
            </div>
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          </div>
        </header>

        <main className="grid min-h-[calc(100vh-89px)] grid-cols-1 gap-8 bg-gray-50 px-8 py-8 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-6">
            <div className="rounded-3xl border border-gray-200 bg-white p-6">
              {loading ? (
                <div className="flex min-h-[440px] flex-col items-center justify-center text-center">
                  <div className="h-16 w-16 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
                  <h3 className="mt-6 text-xl font-semibold text-gray-900">{loadingLabel}</h3>
                  <p className="mt-2 text-sm text-gray-500">{scanProgress || "Fetching verification records"}</p>
                  {pdfInfo && (
                    <p className="mt-3 text-xs text-gray-400">
                      {pdfInfo.name} | {pdfInfo.pages} page(s) | {pdfInfo.size}
                    </p>
                  )}
                </div>
              ) : (
                <div className="min-h-[440px]">
                  {mode === "idle" && (
                    <div className="flex min-h-[440px] flex-col items-center justify-center text-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-blue-200 bg-blue-50 text-blue-600">
                        <QrCode size={38} />
                      </div>
                      <h3 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
                        Ready to verify
                      </h3>
                      <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
                        Choose a verification path from the left sidebar.
                      </p>
                    </div>
                  )}

                  {mode === "qrLive" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">Live QR Scan</h3>
                          <p className="text-sm text-gray-500">Runs QR to database to blockchain verification.</p>
                        </div>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
                          Live
                        </span>
                      </div>
                      <div className="relative overflow-hidden rounded-[28px] border border-gray-200 bg-gray-100">
                        <video ref={videoRef} className="aspect-[16/10] w-full object-cover" autoPlay />
                        <div className="pointer-events-none absolute inset-8 rounded-[24px] border-2 border-blue-400/70" />
                      </div>
                    </div>
                  )}

                  {(mode === "qrImage" || mode === "certificateImage" || mode === "certificatePdf") && (
                    <div className="flex min-h-[440px] items-center justify-center">
                      <label className="w-full max-w-2xl cursor-pointer">
                        <div className="rounded-[28px] border border-dashed border-gray-300 bg-gray-50 px-8 py-16 text-center transition-colors duration-200 hover:border-blue-400 hover:bg-blue-50/40">
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-500">
                            <Upload size={28} />
                          </div>
                          <h3 className="mt-6 text-2xl font-semibold tracking-tight text-gray-900">
                            {mode === "qrImage" && "Upload QR image"}
                            {mode === "certificateImage" && "Upload certificate image"}
                            {mode === "certificatePdf" && "Upload certificate PDF"}
                          </h3>
                          <p className="mt-2 text-sm text-gray-500">
                            {mode === "qrImage" && "QR image runs database and blockchain verification."}
                            {mode === "certificateImage" && "Certificate image runs OCR, database, and blockchain verification."}
                            {mode === "certificatePdf" && "Certificate PDF runs OCR/text, database, and blockchain verification."}
                          </p>
                          <div className="mt-8 inline-flex rounded-xl border border-blue-500 px-5 py-2.5 text-sm font-medium text-blue-600 transition-colors duration-200 hover:bg-blue-500 hover:text-white">
                            Browse files
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept={mode === "certificatePdf" ? ".pdf" : "image/*"}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (mode === "qrImage") processQrImage(file);
                              if (mode === "certificateImage") processCertificateImage(file);
                              if (mode === "certificatePdf") processCertificatePdf(file);
                            }}
                          />
                        </div>
                      </label>
                    </div>
                  )}

                  {mode === "manual" && (
                    <div className="mx-auto flex min-h-[440px] max-w-2xl items-center">
                      <div className="w-full rounded-[28px] border border-gray-200 bg-gray-50 p-8">
                        <div className="mb-6 flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200 bg-white text-blue-600">
                            <ScanLine size={20} />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">Manual QR Input</h3>
                            <p className="text-sm text-gray-500">
                              Paste the QR ID, raw QR payload, or certificate hash for direct blockchain verification.
                            </p>
                          </div>
                        </div>
                        <input
                          ref={manualInputRef}
                          type="text"
                          placeholder="Enter QR ID, QR payload JSON, or certificate hash"
                          className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 font-mono text-sm text-gray-700 outline-none transition-colors duration-200 focus:border-blue-500"
                          onKeyDown={(e) => e.key === "Enter" && verifyManual(e.target.value)}
                        />
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => verifyManual(manualInputRef.current?.value || "")}
                            className="rounded-xl border border-blue-500 bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-white hover:text-blue-600"
                          >
                            Verify on blockchain
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="rounded-3xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Verification Results
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                  Status Panel
                </h2>
              </div>
              {verificationStatus && (
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}>
                  {STATUS_LABELS[verificationStatus] || verificationStatus}
                </span>
              )}
            </div>

            <div className="mt-6 space-y-5">
              {verificationSteps.length > 0 && (
                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                    Step Status
                  </p>
                  <div className="mt-4 space-y-3">
                    {verificationSteps.map((step) => (
                      <div
                        key={step.name}
                        className={`rounded-2xl border p-4 ${
                          step.passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border ${
                              step.passed
                                ? "border-emerald-200 bg-white text-emerald-600"
                                : "border-red-200 bg-white text-red-500"
                            }`}
                          >
                            {step.passed ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-gray-900">
                                {step.label || STEP_LABELS[step.name] || step.name}
                              </p>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  step.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                }`}
                              >
                                {step.passed ? "Passed" : "Failed"}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-gray-600">{step.message}</p>
                            {step.name === "ocr_verified" && Array.isArray(step.details?.expectedSegments) && (
                              <div className="mt-4 space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                                  OCR Field Comparison
                                </p>
                                {step.details.expectedSegments.map((segment) => {
                                  const matched = Boolean(segment.match?.matched);

                                  return (
                                    <div
                                      key={segment.key}
                                      className={`rounded-xl border p-3 ${
                                        matched ? "border-emerald-200 bg-white/80" : "border-red-200 bg-white"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                                          {segment.label}
                                        </p>
                                        <span
                                          className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                            matched
                                              ? "bg-emerald-100 text-emerald-700"
                                              : "bg-red-100 text-red-700"
                                          }`}
                                        >
                                          {matched ? "Matched" : "Mismatch"}
                                        </span>
                                      </div>
                                      <div className="mt-2 grid gap-2 text-xs text-gray-700">
                                        <div>
                                          <span className="font-semibold text-gray-500">QR value:</span>{" "}
                                          <span className="break-words font-medium text-gray-900">
                                            {formatFieldValue(segment.value)}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="font-semibold text-gray-500">OCR value:</span>{" "}
                                          <span className={`break-words font-medium ${matched ? "text-gray-900" : "text-red-700"}`}>
                                            {formatFieldValue(segment.extractedValue)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!certificate && !error && verificationSteps.length === 0 && (
                <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-400">
                    <Info size={28} />
                  </div>
                  <p className="mt-4 text-sm font-medium text-gray-700">Awaiting verification</p>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-gray-500">
                    Step results and certificate details will appear here.
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-3xl border border-red-200 bg-red-50 p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-red-200 bg-white text-red-500">
                      <XCircle size={20} />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-red-900">Validation Error</h4>
                      <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      resetVerificationState();
                      setMode("idle");
                      setScanProgress("");
                      setPdfInfo(null);
                    }}
                    className="mt-6 w-full rounded-xl border border-red-300 px-4 py-3 text-sm font-medium text-red-700 transition-colors duration-200 hover:bg-white"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {certificate && (
                <div className="flex flex-1 flex-col">
                  <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                      Credential
                    </p>
                    <h3 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
                      {certificate.certificateTitle}
                    </h3>
                  </div>

                  <div className="mt-5 space-y-3">
                    {[
                      { label: "Recipient", val: certificate.recipientName, icon: User },
                      { label: "Institution", val: certificate.institutionName, icon: Building },
                      { label: "Course", val: certificate.courseName, icon: BookOpen },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                          <item.icon size={14} />
                          {item.label}
                        </div>
                        <p className="text-sm font-semibold text-gray-800">{item.val}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        <Calendar size={14} />
                        Issued
                      </div>
                      <p className="text-sm font-semibold text-gray-800">
                        {new Date(certificate.completionDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        <Hash size={14} />
                        Record ID
                      </div>
                      <p className="truncate font-mono text-xs font-semibold text-gray-800">
                        {certificate.qrCodeId}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex gap-3">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 rounded-xl border border-blue-500 bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-white hover:text-blue-600"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Printer size={16} />
                        Print
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        resetVerificationState();
                        setPdfInfo(null);
                        setScanProgress("");
                      }}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-600 transition-colors duration-200 hover:border-blue-400 hover:text-blue-600"
                    >
                      <RefreshCcw size={16} />
                    </button>
                  </div>

                  {verificationDetails && (
                    <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Verification Details
                      </p>
                      <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-gray-600">
                        {JSON.stringify(verificationDetails, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
