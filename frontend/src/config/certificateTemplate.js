export const CERTIFICATE_TEMPLATE_VERSION = "1.0";

// Normalized regions for the A4 portrait certificate rendered by Tempelate.jsx.
// Coordinates are relative to the complete certificate image.
export const CERTIFICATE_TEMPLATE = {
  version: CERTIFICATE_TEMPLATE_VERSION,
  fields: {
    certificateId: {
      x: 0.12,
      y: 0.045,
      width: 0.76,
      height: 0.07,
      fieldType: "id",
      minLines: 1,
      maxLines: 1,
      required: true,
      psm: ["7", "11"],
    },
    certificateTitle: {
      x: 0.08,
      y: 0.18,
      width: 0.84,
      height: 0.16,
      fieldType: "text",
      minLines: 1,
      maxLines: 2,
      maxCharacters: 100,
      required: true,
      psm: ["6", "11"],
    },
    studentName: {
      x: 0.08,
      y: 0.35,
      width: 0.84,
      height: 0.11,
      fieldType: "name",
      minLines: 1,
      maxLines: 2,
      maxCharacters: 80,
      required: true,
      psm: ["7", "6"],
    },
    issuerName: {
      x: 0.08,
      y: 0.79,
      width: 0.38,
      height: 0.09,
      fieldType: "name",
      minLines: 1,
      maxLines: 2,
      maxCharacters: 100,
      required: true,
      psm: ["7", "6"],
    },
    completionDate: {
      x: 0.18,
      y: 0.68,
      width: 0.64,
      height: 0.1,
      fieldType: "date",
      minLines: 1,
      maxLines: 2,
      maxCharacters: 40,
      required: true,
      psm: ["7", "6"],
    },
  },
};

export const OCR_FIELD_KEYS = Object.keys(CERTIFICATE_TEMPLATE.fields);
