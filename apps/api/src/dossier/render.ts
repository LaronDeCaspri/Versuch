import { chromium } from "playwright-core";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface Certificate {
  label: string; // ASCII-safe correlation label (asset tag + date)
  contentType: string;
  body: Buffer;
}

function chromiumExecutable(): string | undefined {
  return process.env["CHROMIUM_EXECUTABLE"] ?? undefined;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const exe = chromiumExecutable();
  const browser = await chromium.launch(exe !== undefined ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** Append each certificate after the dossier body so the export is one file. */
export async function appendCertificates(base: Buffer, certs: readonly Certificate[]): Promise<Buffer> {
  const doc = await PDFDocument.load(base);
  const helv = await doc.embedFont(StandardFonts.Helvetica);

  for (const cert of certs) {
    if (cert.contentType === "application/pdf") {
      const src = await PDFDocument.load(cert.body);
      const pages = await doc.copyPages(src, src.getPageIndices());
      for (const p of pages) doc.addPage(p);
      continue;
    }
    if (cert.contentType === "image/png" || cert.contentType === "image/jpeg") {
      const img = cert.contentType === "image/png" ? await doc.embedPng(cert.body) : await doc.embedJpg(cert.body);
      const page = doc.addPage();
      const { width, height } = page.getSize();
      page.drawText(cert.label, { x: 40, y: height - 40, size: 12, font: helv, color: rgb(0.2, 0.2, 0.2) });
      const maxW = width - 80;
      const maxH = height - 100;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      page.drawImage(img, {
        x: (width - img.width * scale) / 2,
        y: (height - 60 - img.height * scale) / 2,
        width: img.width * scale,
        height: img.height * scale,
      });
    }
    // Unsupported content types are silently skipped from the visual append; the
    // dossier body still records that a certificate exists.
  }

  return Buffer.from(await doc.save());
}
