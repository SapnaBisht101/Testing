const A4_WIDTH_MM = "210mm";
const A4_HEIGHT_MM = "297mm";

const ACCENT_BLUE = "#1d5bd8";
const TEXT_DARK = "#1a2540";
const TEXT_MUTED = "#61708d";
const BORDER_LIGHT = "#b8d2ff";

const formatReadableDate = (value) => {
  if (!value) return "N/A";

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  return parsedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const SideRule = ({ width = "28mm" }) => (
  <span
    style={{
      display: "inline-block",
      width,
      height: "1px",
      backgroundColor: BORDER_LIGHT,
    }}
  />
);

const InstitutionHeader = ({ name, qrCodeId, layout }) => (
  <div
    style={{
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "6mm",
    }}
  >
    {/* Certificate ID */}
    <p
      style={{
        margin: 0,
        color: "#2b3448",
        fontSize: "11px",
        fontWeight: "500",
        letterSpacing: "2.2px",
        textTransform: "uppercase",
        fontFamily: "Inter, sans-serif",
      }}
    >
      Certificate ID: {qrCodeId || "XXXX-XXXX-XXXX"}
    </p>

    {/* Institution Name */}
    <h2
      style={{
        margin: 0,
        color: ACCENT_BLUE,
        fontSize: `${layout?.institution?.fontSize || 23}px`,
        fontWeight: "700",
        lineHeight: "1.2",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        fontFamily: "Playfair Display, serif",
        maxWidth: "178mm",
        height: "12mm",
        overflow: "hidden",
      }}
    >
      {name}
    </h2>
  </div>
);

const Tempelate = ({
  certData,
  qrCodeImage,
  qrCodeId,
  layout,
}) => {
  return (
    <div
      id="cert-template"
      data-template-version="1.0"
      style={{
        position: "relative",
        width: A4_WIDTH_MM,
        minWidth: A4_WIDTH_MM,
        height: A4_HEIGHT_MM,
        minHeight: A4_HEIGHT_MM,

        padding: "18mm 14mm 15mm",

        backgroundColor: "#fcfcfb",

        backgroundImage: certData.backgroundImage
          ? `url(${certData.backgroundImage})`
          : "none",

        backgroundSize: "cover",
        backgroundPosition: "center",

        fontFamily: "Inter, sans-serif",

        boxSizing: "border-box",

        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.12)",

        borderRadius: "8px",

        overflow: "hidden",
      }}
    >
      {/* =========================================================
          OUTER BORDER
      ========================================================= */}
      <div
        style={{
          position: "absolute",
          inset: "7mm 6mm",
          border: "1.5px solid #7fadff",
          borderRadius: "8px",
          pointerEvents: "none",
        }}
      />

      {/* =========================================================
          INNER BORDER
      ========================================================= */}
      <div
        style={{
          position: "absolute",
          inset: "9.5mm 8.5mm",
          border: `1px solid ${BORDER_LIGHT}`,
          borderRadius: "8px",
          pointerEvents: "none",
        }}
      />

      {/* =========================================================
          CERTIFICATE CONTENT GRID
          
          Row 1 → Institution
          Row 2 → Certificate Of + Title
          Row 3 → SMALL GAP
          Row 4 → Recipient / Description / Course
          Row 5 → Flexible empty space
          Row 6 → Date / Signature / QR
      ========================================================= */}
      <div
        style={{
          position: "relative",
          zIndex: 1,

          height: "100%",

          display: "grid",

          /*
            IMPORTANT:
            Previously Row 3 was 48mm.

            That created a huge empty gap between:
            ACHIEVEMENT
            and
            Proudly Presented To

            Now Row 3 is only 10mm.
          */
          gridTemplateRows: "28mm 42mm 10mm 76mm 1fr 60mm",

          rowGap: "0",

          minHeight: 0,
        }}
        data-certificate-safe-area
      >
        {/* =======================================================
            ROW 1 — INSTITUTION HEADER
        ======================================================= */}
        <div
          style={{
            gridRow: 1,

            textAlign: "center",

            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <InstitutionHeader
            name={certData.institutionName}
            qrCodeId={qrCodeId}
            layout={layout}
          />
        </div>

        {/* =======================================================
            ROW 2 — CERTIFICATE TITLE
        ======================================================= */}
        <div
          style={{
            gridRow: 2,

            textAlign: "center",

            minHeight: 0,

            overflow: "hidden",
          }}
        >
          {/* Certificate Of */}
          <div
            style={{
              width: "100%",

              display: "flex",

              alignItems: "center",

              justifyContent: "center",

              gap: "4.5mm",

              marginTop: "3mm",
            }}
          >
            <SideRule />

            <h1
              style={{
                margin: 0,

                color: TEXT_DARK,

                fontSize: "32px",

                fontWeight: "500",

                lineHeight: "1",

                textTransform: "uppercase",

                letterSpacing: "1.8px",

                fontFamily: "Inter, sans-serif",
              }}
            >
              Certificate Of
            </h1>

            <SideRule />
          </div>

          {/* Main Certificate Title */}
          <h1
            data-ocr-field="certificateTitle"
            style={{
              /*
                Changed from:
                margin: "2mm 0 0"

                to:
                margin: "0mm"

                This removes unnecessary extra space.
              */
              margin: "0mm",

              color: ACCENT_BLUE,

              fontSize: `${layout?.title?.fontSize || 44}px`,

              fontWeight: "700",

              lineHeight: "1.05",

              textTransform: "uppercase",

              letterSpacing: "1px",

              fontFamily: "Playfair Display, serif",

              maxWidth: "178mm",

              height: "25mm",

              overflow: "hidden",

              overflowWrap: "normal",

              whiteSpace: "normal",
            }}
          >
            {certData.certificateTitle}
          </h1>
        </div>

        {/* =======================================================
            ROW 3 — 10mm EMPTY SPACE
            This is intentional and creates a small gap.
        ======================================================= */}

        {/* =======================================================
            ROW 4 — RECIPIENT / DESCRIPTION / COURSE
        ======================================================= */}
        <div
          style={{
            gridRow: 4,

            /*
              Changed from 2mm → 0mm
              so "Proudly Presented To" moves slightly upward.
            */
            paddingTop: "0mm",

            minHeight: 0,

            overflow: "hidden",

            display: "flex",

            flexDirection: "column",

            alignItems: "center",

            textAlign: "center",
          }}
        >
          {/* Proudly Presented To */}
          <p
            /*
              IMPORTANT:
              This is NOT completionDate.

              So don't use:
              data-ocr-field="completionDate"

              because this text is static.
            */
            style={{
              margin: 0,

              color: TEXT_MUTED,

              fontSize: "18px",

              lineHeight: "1.2",

              fontFamily: "Inter, sans-serif",
            }}
          >
            Proudly Presented To
          </p>

          {/* Student Name */}
          <h2
            data-ocr-field="studentName"
            style={{
              margin: "3mm 0 0",

              color: TEXT_DARK,

              fontSize: `${layout?.student?.fontSize || 47}px`,

              fontWeight: "700",

              lineHeight: "1.05",

              fontFamily: "Playfair Display, serif",

              maxWidth: "178mm",

              height: "18mm",

              overflow: "hidden",
            }}
          >
            {certData.name}
          </h2>

          {/* FOR */}
          <p
            style={{
              margin: "3mm 0 0",

              color: ACCENT_BLUE,

              fontSize: "15px",

              lineHeight: "1",

              fontFamily: "Inter, sans-serif",
            }}
          >
            for
          </p>

          {/* Certificate Description */}
          <p
            style={{
              margin: "3mm 0 0",

              maxWidth: "118mm",

              height: "20mm",

              overflow: "hidden",

              fontSize: `${layout?.description?.fontSize || 17}px`,

              color: "#303949",

              lineHeight: "1.35",

              fontFamily: "Inter, sans-serif",
            }}
          >
            {certData.certificateDescription}
          </p>

          {/* IN */}
          <p
            style={{
              margin: "2mm 0 0",

              color: ACCENT_BLUE,

              fontSize: "15px",

              lineHeight: "1",

              fontFamily: "Inter, sans-serif",
            }}
          >
            in
          </p>

          {/* COURSE NAME */}
          <h3
            data-ocr-field="courseName"
            style={{
              margin: "2mm 0 0",

              color: ACCENT_BLUE,

              fontSize: `${layout?.course?.fontSize || 31}px`,

              fontWeight: "700",

              lineHeight: "1.15",

              maxWidth: "165mm",

              height: "24mm",

              overflow: "hidden",

              textTransform: "uppercase",

              letterSpacing: "0.6px",

              fontFamily: "Playfair Display, serif",
            }}
          >
            {certData.courseName}
          </h3>
        </div>

        {/* =======================================================
            ROW 6 — DATE + SIGNATURE + QR
        ======================================================= */}
        <div
          style={{
            gridRow: 6,

            paddingTop: "2mm",

            minHeight: 0,

            overflow: "hidden",
          }}
        >
          {/* =====================================================
              DATE OF COMPLETION
          ===================================================== */}
          <div
            style={{
              margin: "0 6mm",

              padding: "4mm 0",

              borderTop: `1px solid ${BORDER_LIGHT}`,

              borderBottom: `1px solid ${BORDER_LIGHT}`,

              textAlign: "center",
            }}
          >
            <p
              data-ocr-field="completionDate"
              style={{
                margin: 0,

                color: TEXT_MUTED,

                fontSize: "14px",

                fontWeight: "500",

                letterSpacing: "2px",

                textTransform: "uppercase",

                fontFamily: "Inter, sans-serif",
              }}
            >
              Date Of Completion
            </p>

            <p
              style={{
                margin: "3mm 0 0",

                color: ACCENT_BLUE,

                fontSize: "24px",

                fontWeight: "700",

                lineHeight: "1",

                fontFamily: "Inter, sans-serif",
              }}
            >
              {formatReadableDate(certData.completionDate)}
            </p>
          </div>

          {/* =====================================================
              SIGNATURE + QR
          ===================================================== */}
          <div
            style={{
              marginTop: "4mm",

              padding: "0 8mm",

              display: "flex",

              justifyContent: "space-between",

              alignItems: "flex-end",

              height: "30mm",

              minHeight: 0,
            }}
          >
            {/* ===================================================
                SIGNATURE
            =================================================== */}
            <div
              style={{
                width: "52%",

                textAlign: "center",

                minWidth: 0,

                overflow: "hidden",
              }}
            >
              {/* Signature Image */}
              <div
                style={{
                  height: "32px",

                  marginBottom: "7px",

                  display: "flex",

                  justifyContent: "center",

                  alignItems: "flex-end",
                }}
              >
                {certData.signatureImage ? (
                  <img
                    src={certData.signatureImage}
                    alt="Signature"
                    style={{
                      maxWidth: "100%",

                      maxHeight: "100%",

                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: "12px",

                      color: "#9ca3af",
                    }}
                  >
                    SIGNATURE
                  </span>
                )}
              </div>

              {/* Signature Line */}
              <div
                style={{
                  width: "100%",

                  borderBottom: `2px solid ${ACCENT_BLUE}`,
                }}
              />

              {/* Issuer Name */}
              <p
                data-ocr-field="issuerName"
                style={{
                  margin: "4px 0 0",

                  color: ACCENT_BLUE,

                  fontSize: `${layout?.issuer?.fontSize || 18}px`,

                  fontWeight: "700",

                  fontFamily: "Playfair Display, serif",
                }}
              >
                {certData.issuerName}
              </p>

              {/* Issuer Title */}
              <p
                style={{
                  margin: "2px 0 0",

                  color: "#374151",

                  fontSize: "13px",

                  fontFamily: "Inter, sans-serif",
                }}
              >
                {certData.issuerTitle}
              </p>
            </div>

            {/* ===================================================
                QR CODE
            =================================================== */}
            {qrCodeImage && (
              <div
                data-certificate-qr
                style={{
                  textAlign: "center",

                  width: "32mm",

                  height: "37mm",

                  flexShrink: 0,
                }}
              >
                <img
                  src={qrCodeImage}
                  alt="QR Code"
                  style={{
                    width: "28mm",

                    height: "28mm",

                    objectFit: "contain",

                    background: "#ffffff",

                    padding: "6px",

                    border: `2px solid ${ACCENT_BLUE}`,

                    borderRadius: "6px",
                  }}
                />

                <p
                  style={{
                    margin: "7px 0 0",

                    color: "#374151",

                    fontSize: "10px",

                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  Scan to Verify
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tempelate;