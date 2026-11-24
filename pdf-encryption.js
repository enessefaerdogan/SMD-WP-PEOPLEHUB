
"use strict";

const { PDFDocument } = require("@cantoo/pdf-lib");
const { randomInt } = require("node:crypto");

const MAX_PDF_BYTES = 8 * 1024 * 1024;

const ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Güvenli rastgele parola oluştur
function generatePassword(length = 16) {
    return Array.from(
        { length },
        () => ALPHABET[randomInt(ALPHABET.length)]
    ).join("");
}

// PDF dosyasını AES-256 ile şifrele
async function encryptPdf(pdfBuffer) {

    if (!Buffer.isBuffer(pdfBuffer)) {
        throw new Error("PDF verisi Buffer olmalıdır.");
    }

    if (
        pdfBuffer.length < 8 ||
        pdfBuffer.length > MAX_PDF_BYTES ||
        pdfBuffer.subarray(0, 5).toString() !== "%PDF-"
    ) {
        throw new Error("Geçersiz PDF veya 8 MB sınırı aşıldı.");
    }

    const pdf = await PDFDocument.load(pdfBuffer);

    if (pdf.isEncrypted || pdf.getPageCount() === 0) {
        throw new Error("PDF şifreli veya boş.");
    }

    const password = generatePassword(16);
    const ownerPassword = generatePassword(32);

    pdf.encrypt({
        userPassword: password,
        ownerPassword: ownerPassword,
        algorithm: "AES-256"
    });

    const encryptedPdf = Buffer.from(await pdf.save());

    // Doğru şifre ile açılabildiğini doğrula

    const verified = await PDFDocument.load(
        encryptedPdf,
        { password }
    );

    // Şifreleme durumunu çözülmemiş PDF üzerinden kontrol et
    const encryptedCheck = await PDFDocument.load(
        encryptedPdf,
        { ignoreEncryption: true }
    );

    if (
        !encryptedCheck.isEncrypted ||
        verified.getPageCount() === 0
    ) {
        throw new Error("PDF şifreleme doğrulaması başarısız.");
    }

    // Şifresiz açılmadığını doğrula
    let openedWithoutPassword = false;

    try {
        await PDFDocument.load(encryptedPdf);
        openedWithoutPassword = true;
    } catch {
        // Beklenen davranış: parola gerektirmesi
    }

    if (openedWithoutPassword) {
        throw new Error("PDF şifresiz açılabiliyor.");
    }

    return {
        encryptedPdf,
        password
    };
}

module.exports = {
    encryptPdf
};
