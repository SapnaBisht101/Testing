const createMeasurer = (font) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = font;
  return context;
};

const wrapWords = (text, measure, maxWidth) => {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });

  if (current) lines.push(current);
  return lines;
};

export const fitTextToRegion = ({
  text,
  maxWidth,
  maxHeight,
  maxLines = 1,
  initialFontSize,
  minFontSize,
  fontFamily,
  fontWeight = "400",
  lineHeight = 1.2,
  letterSpacing = 0,
}) => {
  const value = String(text || "").trim();
  const fallback = {
    value,
    fontSize: minFontSize,
    lines: value ? [value] : [],
    lineCount: value ? 1 : 0,
    height: value ? minFontSize * lineHeight : 0,
    fits: !value,
  };

  if (!value || !maxWidth || !maxHeight) return fallback;

  for (let fontSize = initialFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const context = createMeasurer(`${fontWeight} ${fontSize}px ${fontFamily}`);
    const letterSpacingWidth = (value.length - 1) * letterSpacing;
    const measure = (candidate) =>
      context ? context.measureText(candidate).width + letterSpacingWidth : candidate.length * fontSize * 0.6;
    const lines = wrapWords(value, measure, maxWidth);
    const height = lines.length * fontSize * lineHeight;

    if (lines.length <= maxLines && height <= maxHeight) {
      return {
        value,
        fontSize,
        lines,
        lineCount: lines.length,
        height,
        fits: true,
      };
    }
  }

  return {
    ...fallback,
    lines: wrapWords(value, (candidate) => candidate.length * minFontSize * 0.6, maxWidth),
    lineCount: value ? wrapWords(value, (candidate) => candidate.length * minFontSize * 0.6, maxWidth).length : 0,
  };
};

export const calculateCertificateLayout = (data) => {
  const title = fitTextToRegion({
    text: data.certificateTitle,
    maxWidth: 650,
    maxHeight: 92,
    maxLines: 2,
    initialFontSize: 44,
    minFontSize: 28,
    fontFamily: "Playfair Display",
    fontWeight: "700",
    lineHeight: 1.05,
    letterSpacing: 1,
  });
  const student = fitTextToRegion({
    text: data.name,
    maxWidth: 650,
    maxHeight: 64,
    maxLines: 2,
    initialFontSize: 47,
    minFontSize: 30,
    fontFamily: "Playfair Display",
    fontWeight: "700",
    lineHeight: 1.05,
    letterSpacing: 0.3,
  });
  const course = fitTextToRegion({
    text: data.courseName,
    maxWidth: 620,
    maxHeight: 72,
    maxLines: 2,
    initialFontSize: 31,
    minFontSize: 21,
    fontFamily: "Playfair Display",
    fontWeight: "700",
    lineHeight: 1.15,
    letterSpacing: 0.6,
  });
  const issuer = fitTextToRegion({
    text: data.issuerName,
    maxWidth: 230,
    maxHeight: 48,
    maxLines: 2,
    initialFontSize: 18,
    minFontSize: 12,
    fontFamily: "Playfair Display",
    fontWeight: "700",
    lineHeight: 1.1,
  });
  const institution = fitTextToRegion({
    text: data.institutionName,
    maxWidth: 680,
    maxHeight: 42,
    maxLines: 2,
    initialFontSize: 23,
    minFontSize: 15,
    fontFamily: "Playfair Display",
    fontWeight: "700",
    lineHeight: 1.2,
    letterSpacing: 0.5,
  });
  const description = fitTextToRegion({
    text: data.certificateDescription,
    maxWidth: 445,
    maxHeight: 58,
    maxLines: 3,
    initialFontSize: 17,
    minFontSize: 12,
    fontFamily: "Inter",
    lineHeight: 1.35,
  });

  return {
    title,
    student,
    course,
    issuer,
    institution,
    description,
    valid: [title, student, course, issuer, institution, description].every((field) => field.fits),
  };
};
