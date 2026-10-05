  import express from "express";
  import QRCode from "qrcode";
  import { v4 as uuidv4 } from "uuid";
  import crypto from "crypto";
  import {
    certReq as CertiRequest,
    certificate as Certificate,
    student as Student,
    iss_verifier as Issuer,
  } from "../mongo.js";
  import { contract } from "../utils/blockchain.js";
  import multer from "multer";
  import jsQR from "jsqr";
  import { Jimp } from "jimp";

  const router = express.Router();
  const OCR_MATCH_THRESHOLD = 80;

  const generateCertificateHash = (data) => {
    const qrId = String(data.qrCodeId || "").trim();
    const email = String(data.studentEmail || "")
      .trim()
      .toLowerCase();
    const course = String(data.courseName || "")
      .trim()
      .toLowerCase();
    const issuer = String(data.issuerName || "")
      .trim()
      .toLowerCase();

    const hashString = `${qrId}|${email}|${course}|${issuer}`;
    return crypto.createHash("sha256").update(hashString).digest("hex");
  };

  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith("image/")) return cb(null, true);
      cb(new Error("Only image files are allowed"));
    },
  });

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

  const normalizeTextBlock = (value) =>
    normalizeValue(value)
      .replace(/[^a-z0-9@\s./:-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const toNormalizedSearchToken = (value) => normalizeTextBlock(value);
  const toCompactIdentifier = (value) => normalizeValue(value).replace(/[^a-z0-9]/g, "");
  const toWordTokens = (value) => toNormalizedSearchToken(value).split(" ").filter(Boolean);

  const normalizeOcrIdentifier = (value) =>
    toCompactIdentifier(value)
      .replace(/o/g, "0")
      .replace(/[il]/g, "1");

  const levenshteinDistance = (left, right) => {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
        );
      }
      previous.splice(0, previous.length, ...current);
    }

    return previous[right.length];
  };

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
        })
      ),
      toNormalizedSearchToken(
        utcDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          timeZone: "UTC",
        })
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

  const matchOcrSegment = (segment, normalizedOcrText) => {
    const ocrWordSet = new Set(toWordTokens(normalizedOcrText));
    const compactOcrText = toCompactIdentifier(normalizedOcrText);

    if (segment.type === "id") {
      const compactExpectedId = toCompactIdentifier(segment.value);
      return {
        matched: Boolean(compactExpectedId) && compactOcrText.includes(compactExpectedId),
        strategy: "compact_id",
        expected: compactExpectedId,
      };
    }

    if (segment.type === "date") {
      const dateCandidates = buildDateSearchTokens(segment.value);
      const exactDateMatch = dateCandidates.find((candidate) => normalizedOcrText.includes(candidate));

      if (exactDateMatch) {
        return { matched: true, strategy: "date_candidate", expected: exactDateMatch };
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
        matchedTokens: matchedDateTokens,
      };
    }

    const normalizedValue = toNormalizedSearchToken(segment.value);
    if (normalizedValue && normalizedOcrText.includes(normalizedValue)) {
      return { matched: true, strategy: "exact_text", expected: normalizedValue };
    }

    const expectedTokens = toWordTokens(segment.value).filter((token) => token.length > 1);
    const matchedTokens = expectedTokens.filter((token) => ocrWordSet.has(token));

    return {
      matched: expectedTokens.length > 0 && matchedTokens.length === expectedTokens.length,
      strategy: "word_tokens",
      expected: expectedTokens,
      matchedTokens,
    };
  };
  const formatStep = (name, passed, details = {}, message = "") => ({
    name,
    label:
      name === "ocr_verified"
        ? "OCR Verified"
        : name === "db_verified"
          ? "DB Verified"
          : name === "blockchain_verified"
            ? "Blockchain Verified"
            : name,
    passed,
    message,
    details,
  });

  const parseQrPayload = (rawInput) => {
    if (!rawInput || typeof rawInput !== "string") {
      return { qrCodeId: "", payload: null, rawInput: "" };
    }

    const trimmed = rawInput.trim();
    try {
      const parsed = JSON.parse(trimmed);
      return {
        qrCodeId: String(parsed?.qrCodeId || "").trim(),
        payload: parsed,
        rawInput: trimmed,
      };
    } catch {
      return {
        qrCodeId: trimmed,
        payload: { qrCodeId: trimmed },
        rawInput: trimmed,
      };
    }
  };

  const buildCertificatePayload = (cert) => ({
    qrCodeId: cert.qrCodeId,
    studentName: cert.recipientName,
    studentEmail: cert.studentId?.email || "",
    courseName: cert.courseName,
    issuerName: cert.issuerName,
    institutionName: cert.institutionName,
    completionDate: cert.completionDate,
    certificateTitle: cert.certificateTitle,
    templateVersion: cert.templateVersion || "1.0",
  });

  const validateStructuredOcr = (ocrFields, ocrMetadata = {}, ocrValidation = {}) => {
    const fields = ocrFields && typeof ocrFields === "object" ? ocrFields : {};
    const required = ["certificateId", "certificateTitle", "studentName", "issuerName", "completionDate"];
    const errors = [];

    if (ocrMetadata.schemaVersion && ocrMetadata.schemaVersion !== "1.0") {
      errors.push({ code: "OCR_SCHEMA_UNSUPPORTED", field: null });
    }
    if (ocrMetadata.templateVersion && ocrMetadata.templateVersion !== "1.0") {
      errors.push({ code: "TEMPLATE_VERSION_UNSUPPORTED", field: null });
    }
    if (ocrMetadata.overallConfidence != null) {
      const confidence = Number(ocrMetadata.overallConfidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        errors.push({ code: "OCR_INVALID_CONFIDENCE", field: null });
      }
    }
    if (ocrValidation.lineConstraintsValid === false) {
      errors.push({ code: "OCR_LINE_LIMIT_EXCEEDED", field: null });
    }
    required.forEach((field) => {
      if (typeof fields[field] !== "string" || !fields[field].trim()) {
        errors.push({ code: "OCR_FIELD_NOT_FOUND", field });
      }
    });

    return { valid: errors.length === 0, errors };
  };

  const serializeCertificate = (cert) => {
    const plain = cert.toObject ? cert.toObject() : cert;
    return {
      ...plain,
      studentEmail: plain.studentId?.email || "",
    };
  };

  const fetchCertificateByQrId = async (qrCodeId) => {
    if (!qrCodeId?.trim()) return null;
    return Certificate.findOne({ qrCodeId: qrCodeId.trim() }).populate("studentId");
  };

  const fetchCertificateByHash = async (certificateHash) => {
    if (!certificateHash?.trim()) return null;
    return Certificate.findOne({
      certificateHash: certificateHash.trim().toLowerCase(),
    }).populate("studentId");
  };

  const verifyAgainstDatabase = (cert, qrPayload = {}) => {
    const expectedPayload = buildCertificatePayload(cert);
    const comparedFields = [
      ["qrCodeId", "Certificate ID"],
      ["studentName", "Student Name"],
      ["issuerName", "Issuer Name"],
      ["certificateTitle", "Certificate Title"],
      ["completionDate", "Date Of Issuance"],
    ];

    if (cert.status === "revoked") {
      return formatStep(
        "db_verified",
        false,
        { mismatches: ["status"], expectedPayload },
        "Certificate is revoked in the database registry."
      );
    }

    const mismatches = comparedFields
      .filter(([key]) => {
        const qrValue = normalizeValue(qrPayload[key]);
        if (!qrValue) return false;
        if (key === "completionDate") {
          const qrTokens = buildDateSearchTokens(qrPayload[key]);
          const expectedTokens = buildDateSearchTokens(expectedPayload[key]);
          return !qrTokens.some((token) => expectedTokens.includes(token));
        }
        return qrValue !== normalizeValue(expectedPayload[key]);
      })
      .map(([, label]) => label);

    return formatStep(
      "db_verified",
      mismatches.length === 0,
      {
        comparedFields: comparedFields.map(([, label]) => label),
        mismatches,
        expectedPayload,
      },
      mismatches.length === 0
        ? "Certificate data matches the database record."
        : "Certificate data does not match the database record."
    );
  };

  const verifyAgainstBlockchain = async (cert) => {
    let onChainData;
    try {
      onChainData = await contract.getCertificate(cert.qrCodeId.trim());
    } catch (error) {
      console.error(`[VERIFY][BLOCKCHAIN] Lookup failed for ${cert.qrCodeId}:`, error);
      return formatStep(
        "blockchain_verified",
        false,
        {
          blockchainHash: null,
          databaseHash: cert.certificateHash || null,
          transactionHash: cert.txHash || null,
          errorCode: error.code || "BLOCKCHAIN_LOOKUP_FAILED",
          error: error.shortMessage || error.message,
        },
        "Blockchain record could not be read. Check that the local RPC node and deployed contract are running.",
      );
    }

    const blockchainHash = onChainData?.certificateHash || "";

    if (!blockchainHash) {
      return formatStep(
        "blockchain_verified",
        false,
        {
          blockchainHash: null,
          databaseHash: cert.certificateHash || null,
          transactionHash: cert.txHash || null,
        },
        "No blockchain record found for this certificate."
      );
    }

    const currentDbHash = generateCertificateHash({
      qrCodeId: cert.qrCodeId,
      studentEmail: cert.studentId?.email,
      courseName: cert.courseName,
      issuerName: cert.issuerName,
    });

    const passed = currentDbHash === blockchainHash;
    return formatStep(
      "blockchain_verified",
      passed,
      {
        blockchainHash,
        databaseHash: currentDbHash,
        storedHash: cert.certificateHash || null,
        transactionHash: cert.txHash || null,
      },
      passed
        ? "Blockchain hash matches the certificate record."
        : "Blockchain hash does not match the certificate record."
    );
  };

  const verifyOcrVsQr = (rawOcrText = "", qrPayload = {}) => {
    const cleanedText = cleanOCR(rawOcrText);
    const normalizedOcrText = normalizeTextBlock(cleanedText);
    const expectedSegments = buildExpectedOcrSegments(qrPayload);
    const segmentResults = expectedSegments.map((segment) => ({
      ...segment,
      match: matchOcrSegment(segment, normalizedOcrText),
    }));
    const missingSegments = segmentResults
      .filter((segment) => !segment.match.matched)
      .map((segment) => segment.label);
    const matchedSegments = segmentResults.filter((segment) => segment.match.matched).length;
    const matchPercentage = expectedSegments.length
      ? (matchedSegments / expectedSegments.length) * 100
      : 0;
    const passed = matchPercentage >= OCR_MATCH_THRESHOLD;

    return formatStep(
      "ocr_verified",
      passed,
      {
        matchPercentage,
        matchThreshold: OCR_MATCH_THRESHOLD,
        matchedSegments,
        totalSegments: expectedSegments.length,
        expectedSegments: segmentResults.map(({ key, label, value, type, match }) => ({
          key,
          label,
          value,
          type,
          match,
        })),
        missingSegments,
        rawOcrText: cleanedText,
        ignoredVisualElements: ["signatureImage", "institutionLogo"],
      },
      passed
        ? `OCR matches ${matchPercentage.toFixed(0)}% of the QR certificate data.`
        : `OCR matches only ${matchPercentage.toFixed(0)}% of the QR certificate data; 80% is required.`
    );
  };

  const verifyStructuredOcrVsQr = (
    ocrFields = {},
    qrPayload = {},
    schemaValidation,
    rawText = "",
  ) => {
    const comparisons = [
      ["certificateId", "qrCodeId", "Certificate ID"],
      ["studentName", "studentName", "Student Name"],
      ["issuerName", "issuerName", "Issuer Name"],
      ["certificateTitle", "certificateTitle", "Certificate Title"],
      ["completionDate", "completionDate", "Date Of Issuance"],
    ];
    const comparisonResults = comparisons.map(([ocrKey, qrKey, label]) => {
        const actual = normalizeValue(ocrFields[ocrKey]);
        const expected = normalizeValue(qrPayload[qrKey]);
        if (!actual || !expected) return { ocrKey, qrKey, label, matched: false };

        if (ocrKey === "certificateId") {
          const expectedId = normalizeOcrIdentifier(expected);
          const actualId = normalizeOcrIdentifier(actual);
          const rawId = normalizeOcrIdentifier(rawText);
          const directMatch = actualId.includes(expectedId) || rawId.includes(expectedId);
          const fuzzyMatch =
            Math.abs(expectedId.length - actualId.length) <= 2 &&
            levenshteinDistance(expectedId, actualId) <= 2;
          return { ocrKey, qrKey, label, matched: directMatch || fuzzyMatch };
        }

        if (ocrKey === "completionDate" && actual && expected) {
          const actualDate = new Date(actual);
          const expectedDate = new Date(expected);
          return {
            ocrKey,
            qrKey,
            label,
            matched:
              !Number.isNaN(actualDate.getTime()) &&
              !Number.isNaN(expectedDate.getTime()) &&
              actualDate.toISOString().slice(0, 10) === expectedDate.toISOString().slice(0, 10),
          };
        }
        if (actual === expected) return { ocrKey, qrKey, label, matched: true };

        const expectedTokens = toWordTokens(expected).filter((token) => token.length > 1);
        const actualTokens = new Set(toWordTokens(actual));
        const matchedTokens = expectedTokens.filter((token) => actualTokens.has(token));
        return {
          ocrKey,
          qrKey,
          label,
          matched: expectedTokens.length > 0 && matchedTokens.length / expectedTokens.length >= 0.6,
        };
      });
    const matchedFields = comparisonResults.filter((comparison) => comparison.matched).length;
    const matchPercentage = comparisons.length ? (matchedFields / comparisons.length) * 100 : 0;
    const mismatches = comparisonResults
      .filter((comparison) => !comparison.matched)
      .map((comparison) => comparison.label);
    const errors = schemaValidation?.errors || [];
    const passed = matchPercentage >= OCR_MATCH_THRESHOLD && errors.length === 0;

    return formatStep(
      "ocr_verified",
      passed,
      {
        structured: true,
        matchPercentage,
        matchThreshold: OCR_MATCH_THRESHOLD,
        matchedFields,
        totalFields: comparisons.length,
        mismatches,
        schemaErrors: errors,
        expectedPayload: qrPayload,
        ocrFields,
        rawOcrText: cleanOCR(rawText),
      },
      passed
        ? `Structured OCR matches ${matchPercentage.toFixed(0)}% of the QR payload.`
        : `Structured OCR matches only ${matchPercentage.toFixed(0)}% of the QR payload; 80% is required.`,
    );
  };

  const sendVerificationResponse = (res, { cert = null, steps = [], fallbackStatus }) => {
    const valid = steps.every((step) => step.passed);
    const failedStep = steps.find((step) => !step.passed);

    return res.json({
      valid,
      status: valid ? "VERIFIED" : fallbackStatus || "INVALID",
      message: valid
        ? "Certificate verification successful."
        : failedStep?.message || "Certificate verification failed.",
      steps,
      data: cert ? serializeCertificate(cert) : null,
    });
  };

  router.post("/extract-qr", upload.single("qrImage"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No image uploaded" });
      }

      const image = await Jimp.read(req.file.buffer);
      const qr = jsQR(
        new Uint8ClampedArray(image.bitmap.data),
        image.bitmap.width,
        image.bitmap.height
      );

      if (!qr) {
        return res.status(400).json({ success: false, message: "No QR code detected" });
      }

      return res.json({ success: true, qrData: qr.data });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to process image" });
    }
  });

  router.patch("/revoke/:qrCodeId", async (req, res) => {
    try {
      const { qrCodeId } = req.params;

      const cert = await Certificate.findOneAndUpdate(
        { qrCodeId },
        { status: "revoked", revokedAt: new Date() },
        { new: true }
      );

      if (!cert) {
        return res.status(404).json({ success: false, message: "Certificate not found" });
      }

      return res.json({
        success: true,
        message: "Certificate revoked",
        data: cert,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to revoke certificate" });
    }
  });

  router.post("/generate-qr", async (req, res) => {
    try {
      const {
        studentEmail,
        courseName,
        completionDate,
        issuerName,
        institutionName,
        certificateTitle,
        certificateDescription,
        templateVersion = "1.0",
      } = req.body;

      const removeRequest = req.body.remove_request;
      const student = await Student.findOne({ email: studentEmail });
      const issuer = await Issuer.findOne({ issuerName });

      if (!student || !issuer) {
        return res.status(400).json({ success: false, message: "Student or Issuer not found" });
      }

      const qrCodeId = uuidv4();
      const normalizedCompletionDate = completionDate ? new Date(completionDate) : new Date();

      const certificateHash = generateCertificateHash({
        qrCodeId,
        studentEmail: student.email,
        courseName,
        issuerName: issuer.issuerName,
      });

      const tx = await contract.issueCertificate(qrCodeId, certificateHash, "N/A", issuer._id.toString());
      const receipt = await tx.wait();

      const payload = {
        qrCodeId,
        studentName: student.name,
        studentEmail: student.email,
        courseName,
        issuerName: issuer.issuerName,
        institutionName: institutionName || issuer.institutionName,
        completionDate: normalizedCompletionDate.toISOString(),
        certificateTitle,
        templateVersion,
      };
      const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(payload));

      const newCert = new Certificate({
        qrCodeId,
        studentId: student._id,
        recipientName: student.name,
        issuerId: issuer._id,
        issuerName: issuer.issuerName,
        institutionName: institutionName || issuer.institutionName,
        certificateTitle,
        courseName,
        certificateDescription,
        templateVersion,
        qrImage: qrCodeUrl,
        completionDate: normalizedCompletionDate,
        certificateHash,
        txHash: receipt.hash,
        isOnChain: true,
        status: "active",
      });

      await newCert.save();

      if (removeRequest) {
        await CertiRequest.findByIdAndDelete(removeRequest);
      }

      return res.json({
        success: true,
        message: "Certificate secured on blockchain.",
        certificate: newCert,
        qrCodeUrl,
        blockchainTx: receipt.hash,
      });
    } catch (error) {
      console.error("Blockchain/DB Error:", error);
      return res.status(500).json({
        success: false,
        message: "Blockchain transaction failed",
        error: error.message,
      });
    }
  });

  router.post("/verify-manual", async (req, res) => {
    try {
      const { manualInput } = req.body;
      const parsed = parseQrPayload(manualInput);
      let cert = await fetchCertificateByQrId(parsed.qrCodeId);

      if (!cert && /^[a-f0-9]{64}$/i.test(parsed.rawInput || "")) {
        cert = await fetchCertificateByHash(parsed.rawInput);
      }

      if (!cert) {
        return res.status(404).json({
          valid: false,
          message: "Certificate not found for the provided manual input.",
        });
      }

      const blockchainStep = await verifyAgainstBlockchain(cert);
      return sendVerificationResponse(res, {
        cert,
        steps: [blockchainStep],
        fallbackStatus: "BLOCKCHAIN_FAILED",
      });
    } catch (error) {
      console.error("Manual verification error:", error);
      return res.status(500).json({
        valid: false,
        message: "Server error during manual verification.",
      });
    }
  });

  router.post("/verify-qr", async (req, res) => {
    try {
      const { qrData } = req.body;
      const parsed = parseQrPayload(qrData);

      if (!parsed.qrCodeId) {
        return res.status(400).json({
          valid: false,
          message: "QR Code ID is missing in the scanned payload.",
        });
      }

      const cert = await fetchCertificateByQrId(parsed.qrCodeId);
      if (!cert) {
        return res.status(404).json({ valid: false, message: "Certificate not found in registry." });
      }

      const dbStep = verifyAgainstDatabase(cert, parsed.payload);
      const blockchainStep = await verifyAgainstBlockchain(cert);

      return sendVerificationResponse(res, {
        cert,
        steps: [dbStep, blockchainStep],
        fallbackStatus: "QR_VERIFICATION_FAILED",
      });
    } catch (error) {
      console.error("QR verification error:", error);
      return res.status(500).json({
        valid: false,
        message: "Server error during QR verification.",
      });
    }
  });

  router.post("/verify-certificate", async (req, res) => {
    try {
      const { qrData, rawText, ocrFields, ocrMetadata, ocrValidation } = req.body;
      const parsed = parseQrPayload(qrData);
      console.log("[VERIFY][CERTIFICATE][OCR_RAW_TEXT]", cleanOCR(rawText || ""));

      if (!parsed.qrCodeId) {
        return res.status(400).json({
          valid: false,
          message: "QR Code ID is missing in the certificate payload.",
        });
      }

      const cert = await fetchCertificateByQrId(parsed.qrCodeId);
      if (!cert) {
        return res.status(404).json({ valid: false, message: "Certificate not found in registry." });
      }

      const structuredValidation = ocrFields
        ? validateStructuredOcr(ocrFields, ocrMetadata, ocrValidation)
        : null;
      const ocrStep = ocrFields && structuredValidation
        ? verifyStructuredOcrVsQr(ocrFields, parsed.payload, structuredValidation, rawText)
        : verifyOcrVsQr(rawText, parsed.payload);
      if (!ocrStep.passed) {
        return sendVerificationResponse(res, {
          steps: [ocrStep],
          fallbackStatus: "CERTIFICATE_INVALID_OCR_MISMATCH",
        });
      }
      const dbStep = verifyAgainstDatabase(cert, parsed.payload);
      const blockchainStep = await verifyAgainstBlockchain(cert);

      return sendVerificationResponse(res, {
        cert,
        steps: [ocrStep, dbStep, blockchainStep],
        fallbackStatus: "CERTIFICATE_VERIFICATION_FAILED",
      });
    } catch (error) {
      console.error("Certificate verification error:", error);
      return res.status(500).json({
        valid: false,
        message: "Server error during certificate verification.",
      });
    }
  });

  router.post("/verify-data", async (req, res) => {
    try {
      const qrData =
        req.body.clientData && Object.keys(req.body.clientData).length > 0
          ? JSON.stringify(req.body.clientData)
          : req.body.qrCodeId;

      const parsed = parseQrPayload(qrData);
      if (!parsed.qrCodeId) {
        return res.status(400).json({
          valid: false,
          message: "QR Code ID is missing in the provided data.",
        });
      }

      const cert = await fetchCertificateByQrId(parsed.qrCodeId);
      if (!cert) {
        return res.status(404).json({ valid: false, message: "Certificate not found in registry." });
      }

      const dbStep = verifyAgainstDatabase(cert, parsed.payload);
      const blockchainStep = await verifyAgainstBlockchain(cert);

      return sendVerificationResponse(res, {
        cert,
        steps: [dbStep, blockchainStep],
        fallbackStatus: "QR_VERIFICATION_FAILED",
      });
    } catch (error) {
      console.error("Legacy verification error:", error);
      return res.status(500).json({
        valid: false,
        message: "Server error during verification.",
      });
    }
  });

  export default router;
