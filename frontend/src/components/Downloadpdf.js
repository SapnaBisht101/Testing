
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// --- Download and Save Logic (Unchanged) ---
const handleDownloadPDF = async (qrCodeImage,qrCodeId,setLoading,showMessage,certData) => {
  if (!qrCodeId) {
    showMessage("Issue the Certificate before downloading the PDF.");
    return;
  }

  const element = document.getElementById("cert-template");
  if (!element) {
    showMessage("Error: Template not found.");
    return;
  }

  setLoading(true);
  showMessage("Generating PDF...");

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    const bounds = element.getBoundingClientRect();
    const safeArea = element.querySelector("[data-certificate-safe-area]")?.getBoundingClientRect();
    const qrElement = element.querySelector("[data-certificate-qr]")?.getBoundingClientRect();
    const requiredBounds = [safeArea, qrElement].filter(Boolean);
    const invalidBounds = requiredBounds.some(
      (item) =>
        item.left < bounds.left ||
        item.right > bounds.right ||
        item.top < bounds.top ||
        item.bottom > bounds.bottom,
    );
    if (invalidBounds) {
      throw new Error("Certificate content does not fit inside the A4 page.");
    }

    // Capture high-quality render of the certificate
    const canvas = await html2canvas(element, {
      scale: 3,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.98);

    // Create PDF in real A4 landscape dimension
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    // Draw image to fill entire PDF page edge-to-edge
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);

    const fileName = `${certData.name.replace(/\s+/g, "_")}_Certificate_${qrCodeId}.pdf`;
    pdf.save(fileName);

  } catch (error) {
    console.error("PDF generation failed:", error);
    showMessage("❌ PDF generation failed. Please try again.");
  } finally {
    setLoading(false);
  }
};

export default handleDownloadPDF;