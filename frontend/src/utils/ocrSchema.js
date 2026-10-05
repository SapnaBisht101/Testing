import { CERTIFICATE_TEMPLATE, CERTIFICATE_TEMPLATE_VERSION, OCR_FIELD_KEYS } from "../config/certificateTemplate.js";

export const OCR_SCHEMA_VERSION = "1.0";

export const createEmptyOcrResult = (templateVersion = CERTIFICATE_TEMPLATE_VERSION) => ({
  schemaVersion: OCR_SCHEMA_VERSION,
  templateVersion,
  success: false,
  certificateId: null,
  certificateTitle: null,
  studentName: null,
  issuerName: null,
  completionDate: null,
  confidence: {
    certificateId: 0,
    certificateTitle: 0,
    studentName: 0,
    issuerName: 0,
    completionDate: 0,
    overall: 0,
  },
  validation: {
    valid: false,
    schemaValid: true,
    allRequiredFieldsPresent: false,
    lineConstraintsValid: false,
    ocrMatchesQr: false,
  },
  errors: [],
  rawText: "",
});

export const toOcrFieldKey = (key) => (key === "qrCodeId" ? "certificateId" : key);

export const buildOcrResult = ({ fields = {}, rawText = "", templateVersion = CERTIFICATE_TEMPLATE_VERSION }) => {
  const result = createEmptyOcrResult(templateVersion);
  const fieldResults = {};

  OCR_FIELD_KEYS.forEach((key) => {
    const outputKey = toOcrFieldKey(key);
    const field =
      fields[key] ||
      fields[outputKey] ||
      (key === "certificateId" ? fields.qrCodeId : null) ||
      {};
    const value = field.accepted === false ? null : field.value ?? field.rawValue ?? null;
    const confidence = Number.isFinite(field.confidence) ? field.confidence : 0;
    result[outputKey] = value;
    result.confidence[outputKey] = Math.max(0, Math.min(1, confidence));
    fieldResults[outputKey] = field;
  });

  const confidenceValues = Object.values(result.confidence).filter((value) => value > 0);
  result.confidence.overall = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;

  const requiredFieldsPresent = OCR_FIELD_KEYS.every((key) => {
    const outputKey = toOcrFieldKey(key);
    return !CERTIFICATE_TEMPLATE.fields[key]?.required || Boolean(result[outputKey]);
  });
  const lineConstraintsValid = OCR_FIELD_KEYS.every((key) => {
    const field = fieldResults[toOcrFieldKey(key)];
    return field?.lineConstraintsValid !== false;
  });

  result.validation.allRequiredFieldsPresent = requiredFieldsPresent;
  result.validation.lineConstraintsValid = lineConstraintsValid;
  result.validation.valid = requiredFieldsPresent && lineConstraintsValid;
  result.success = result.validation.valid;
  result.rawText = rawText;
  return result;
};
