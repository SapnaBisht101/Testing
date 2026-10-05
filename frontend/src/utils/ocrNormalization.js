export const normalizeOcrText = (value) =>
  String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/[|—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeOcrField = (value, fieldType) => {
  const normalized = normalizeOcrText(value);
  if (!normalized) return null;
  if (fieldType === "id") return normalized.toLowerCase().replace(/[^a-z0-9-]/gi, "");
  return normalized;
};

export const parseCanonicalDate = (value) => {
  const raw = normalizeOcrText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

export const validateOcrField = (value, config) => {
  const normalized = normalizeOcrField(value, config.fieldType);
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errors = [];

  if (!normalized && config.required) errors.push("OCR_FIELD_NOT_FOUND");
  if (config.maxCharacters && normalized && normalized.length > config.maxCharacters) {
    errors.push("OCR_FIELD_TOO_LONG");
  }
  if (lines.length < config.minLines || lines.length > config.maxLines) {
    errors.push("OCR_LINE_LIMIT_EXCEEDED");
  }
  if (config.fieldType === "date" && normalized && !parseCanonicalDate(normalized)) {
    errors.push("OCR_INVALID_DATE");
  }
  if (["name", "text"].includes(config.fieldType) && normalized && !/[a-z]/i.test(normalized)) {
    errors.push("OCR_INVALID_TEXT");
  }

  return {
    value: config.fieldType === "date" ? parseCanonicalDate(normalized) : normalized,
    valid: errors.length === 0,
    errors,
    linesDetected: lines.length,
  };
};
