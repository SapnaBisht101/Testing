import React, { useState, useCallback, useMemo } from "react";
import { useMessage } from "../GlobalMessageProvider.jsx";
import axios from "axios";
import { fetchUserDetails } from "../../js/fetch.js";
import { useLocation, useNavigate } from "react-router";
import Tempelate from "../../components/Tempelate.jsx";
import handleDownloadPDF from "../../components/Downloadpdf.js";
import { ArrowLeft } from "lucide-react";
import { CERTIFICATE_TEMPLATE_VERSION } from "../../config/certificateTemplate.js";
import { calculateCertificateLayout } from "../../utils/textFitting.js";
// Utility: Converts File object to Base64 string
const fileToBase64 = (file) =>
  new Promise((res, rej) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => res(reader.result);
    reader.onerror = (e) => rej(e);
  });

const FIELD_LIMITS = {
  certificateTitle: { maxCharacters: 100, maxLines: 2 },
  name: { maxCharacters: 80, maxLines: 2 },
  issuerName: { maxCharacters: 100, maxLines: 2 },
  institutionName: { maxCharacters: 120, maxLines: 2 },
  courseName: { maxCharacters: 100, maxLines: 2 },
  certificateDescription: { maxCharacters: 180, maxLines: 4 },
};

const validateCertificateText = (data) => {
  const errors = [];
  Object.entries(FIELD_LIMITS).forEach(([field, limits]) => {
    const value = String(data[field] || "").trim();
    const lineCount = value ? Math.ceil(value.length / Math.max(1, Math.floor(limits.maxCharacters / limits.maxLines))) : 0;
    if (!value) errors.push(`${field} is required.`);
    if (value.length > limits.maxCharacters) {
      errors.push(`${field} is too long (maximum ${limits.maxCharacters} characters).`);
    }
    if (lineCount > limits.maxLines) {
      errors.push(`${field} must fit within ${limits.maxLines} lines.`);
    }
  });
  return errors;
};

// Custom Hook for Drag and Drop
const useDragAndDrop = (onDrop) => {
  const h = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const hO = useCallback(
    (e) => {
      h(e);
      e.currentTarget.classList.add("border-indigo-500", "bg-indigo-50");
    },
    [h],
  );
  const hL = useCallback(
    (e) => {
      h(e);
      e.currentTarget.classList.remove("border-indigo-500", "bg-indigo-50");
    },
    [h],
  );
  const hD = useCallback(
    (e) => {
      h(e);
      e.currentTarget.classList.remove("border-indigo-500", "bg-indigo-50");
      if (e.dataTransfer.files?.[0]) onDrop(e.dataTransfer.files[0]);
    },
    [onDrop, h],
  );
  return { hO, hL, hD };
};

const CertificateGenerator = () => {
  const { showMessage } = useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const issuerDetails = location.state;
  console.log(issuerDetails);

  const initialDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  console.log(initialDate);
  
  // Initialize certData with defaults/issuerDetails
  const [certData, setCertData] = useState({
    name: "Recipient Name",
    courseName: "Course Name",
    // Issuer details are pre-filled and not editable from the form
    issuerName: issuerDetails?.issuerName || "Jane Doe",
    issuerTitle: issuerDetails?.issuerTitle || "Director of Training",
    institutionName: issuerDetails?.institutionName || "Institution Name",
    completionDate: initialDate,
    certificateTitle: "ACHIEVEMENT",
    certificateDescription:
      "outstanding dedication and successful completion of the prestigious program",
    logoImage: issuerDetails?.institutionLogo || null,
    signatureImage: issuerDetails?.signatureImage || null,
    backgroundImage: null,
  });

  let stemail = issuerDetails.studentEmail;
  let remove_request = issuerDetails.remove_request;
  console.log(stemail);

  const [studentemail, setstudentemail] = useState(stemail ? stemail : "");
  // Verifier Email is now read-only and used only in API calls
  const [verifieremail, setverifierEmail] = useState(
    issuerDetails?.email || "",
  );

  const [qrCodeImage, setQrCodeImage] = useState(null);
  const [qrCodeId, setQrCodeId] = useState(null);

  const [loading, setLoading] = useState(false);
  const layout = useMemo(() => calculateCertificateLayout(certData), [certData]);

  // --- Data Fetching Logic ---
  const fetchStudentDetails = async () => {
    if (!studentemail)
      return showMessage("Please enter a Student Email.", "error");
    setLoading(true);
    showMessage("Fetching student details...");
    try {
      const data = await fetchUserDetails("student", studentemail);
      console.log(data);

      setCertData((prev) => ({
        ...prev,
        name: data.name,
        completionDate: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      }));
      showMessage(
        `Student "${data.name}" (${studentemail}) found. You can proceed with certificate generation.`,
        "success",
      );
    } catch (err) {
      if (err.status === 404) {
        showMessage(`Student not found: ${studentemail}`, "error");
      } else {
        showMessage(`Error: ${err.message}`, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Form & Image Handlers (Modified for simpler form) ---
  const handleChange = (e) =>
    setCertData({ ...certData, [e.target.name]: e.target.value });

  const handleImageFileChange = async (e, field) => {
    const file = e.target.files ? e.target.files[0] : e;
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        setCertData((p) => ({ ...p, [field]: base64 }));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }
  };

  // Only Background Drag and Drop is needed now
  const {
    hO: bgDragO,
    hL: bgDragL,
    hD: bgDrop,
  } = useDragAndDrop((f) => handleImageFileChange(f, "backgroundImage"));

  // --- QR Code Generation (API call to save provisional data) ---
  const handleGenerateQrCode = async () => {
    if (!certData.name || certData.name === "Recipient Name")
      return showMessage(
        "Please fetch student details or enter recipient name.",
        "error",
      );

    const validationErrors = validateCertificateText(certData);
    if (validationErrors.length > 0) {
      showMessage(validationErrors[0], "error");
      return;
    }
    if (!layout.valid) {
      showMessage("Certificate text does not fit the fixed certificate layout.", "error");
      return;
    }

    setLoading(true);
    showMessage("Generating QR code and saving data...");

    try {
      const payload = {
        studentName: certData.name,
        studentEmail: studentemail,
        courseName: certData.courseName,
        completionDate: certData.completionDate,
        issuerName: certData.issuerName,
        institutionName: certData.institutionName,
        certificateTitle: certData.certificateTitle,
        certificateDescription: certData.certificateDescription,
        templateVersion: CERTIFICATE_TEMPLATE_VERSION,
        remove_request: remove_request,
      };

      console.log("API Request Payload:", payload);

      const res = await axios.post(
        "http://localhost:4000/certificates/generate-qr",
        payload,
      );
      console.log("API Response:", res.data);

      if (!res.data || !res.data.certificate) {
        throw new Error("Invalid API response format");
      }

      const { qrCodeId } = res.data.certificate;
      const qrCodeUrl = res.data.qrCodeUrl;
      console.log("Received QR Data:", { qrCodeId, qrCodeUrl });

      setQrCodeId(qrCodeId);
      setQrCodeImage(qrCodeUrl);

      console.log("Updated State:", {
        qrCodeImage: qrCodeImage,
        qrCodeId: qrCodeId,
      });

      showMessage(`QR Code generated ✅ ID: ${qrCodeId}`);
    } catch (e) {
      console.error("Error:", e.message);
      showMessage("Some Error Occured ❌", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex justify-center p-4 lg:p-10 font-sans">
      {/* Main Container - Divided into two flexible columns */}
      <div className="w-full max-w-7xl flex flex-col lg:flex-row lg:space-x-8">
        {/* Left Column: Controls (Smaller/Fixed Width on large screens) */}
        {/* Left Column: Controls */}
        <div className="lg:w-1/3 w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-6 mb-6 lg:mb-0 lg:sticky lg:top-10 lg:h-fit">
          {/* Header */}
          <div className="flex gap-4 mb-4 items-center justify-center">
            <img src="pnglogo.png" alt="" className="h-16 w-16" />
            <div className="border-b border-gray-100">
              <h2 className="text-xl font-semibold text-gray-900">
                Issue Certificate
              </h2>
              <p className="text-sm text-gray-500 mt-1">DECIVE Certificate</p>
            </div>
            <button
              onClick={() => navigate(-1)}
              className="group flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition"
            >
              {" "}
              <ArrowLeft
                size={16}
                className="transition-transform duration-200 group-hover:-translate-x-1"
              />
              <span className="text-sm font-medium text-gray-700">Back</span>
            </button>
          </div>

          {/* Issuer Info */}
          <div className="mb-6 space-y-1 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border">
            <p>
              <span className="font-semibold text-gray-800">Issuer:</span>{" "}
              {certData.issuerName}
            </p>
            <p>
              <span className="font-semibold text-gray-800">Role:</span>{" "}
              {certData.issuerTitle}
            </p>
            <p>
              <span className="font-semibold text-gray-800">Institution:</span>{" "}
              {certData.institutionName}
            </p>
            <p>
              <span className="font-semibold text-gray-800">
                Verifier Email:
              </span>{" "}
              {verifieremail}
            </p>
          </div>

          {/* Student Email */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Student Email
            </label>

            <input
              type="text"
              value={studentemail}
              onChange={(e) => setstudentemail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="student@example.com"
            />

            <button
              onClick={fetchStudentDetails}
              disabled={!studentemail || loading}
              className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              Fetch Student Details
            </button>

            <p className="text-xs text-gray-500 mt-2">
              Recipient:{" "}
              <span className="font-medium text-gray-700">{certData.name}</span>
            </p>
          </div>

          {/* Certificate Fields */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Course / Program
              </label>
              <input
                type="text"
                name="courseName"
                value={certData.courseName}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Certificate of
              </label>
              <input
                type="text"
                name="certificateTitle"
                value={certData.certificateTitle}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Completion Date
              </label>
              <input
                type="text"
                name="completionDate"
                value={certData.completionDate}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                name="certificateDescription"
                value={certData.certificateDescription}
                onChange={handleChange}
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 border-t pt-5">
            <button
              onClick={handleGenerateQrCode}
              disabled={loading || qrCodeImage}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {qrCodeImage
                ? `Issued ✓ (${qrCodeId})`
                : loading
                  ? "Generating..."
                  : "Issue Certificate"}
            </button>

            <button
              onClick={() =>
                handleDownloadPDF(
                  qrCodeImage,
                  qrCodeId,
                  setLoading,
                  showMessage,
                  certData,
                )
              }
              disabled={loading || !qrCodeImage}
              className="w-full py-3 border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Generating PDF..." : "Download Certificate"}
            </button>
          </div>
        </div>

        {/* Right Column: Certificate Preview (Larger/Flexible Width) */}
        <div className="lg:w-2/3 w-full overflow-auto">
          <div className="mx-auto flex min-w-fit justify-center pb-4">
            <Tempelate
              certData={certData}
              qrCodeImage={qrCodeImage}
              qrCodeId={qrCodeId}
              layout={layout}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CertificateGenerator;
