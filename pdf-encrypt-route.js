
"use strict";

const express = require("express");
const { encryptPdf } = require("./pdf-encryption");

const router = express.Router();

router.post(
  "/v1/pdf/encrypt",
  express.raw({
    type: "application/pdf",
    limit: "8mb"
  }),
  async (req, res) => {
    try {
      if (!req.is("application/pdf")) {
        return res.status(415).json({
          error: "Content-Type must be application/pdf"
        });
      }

      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({
          error: "PDF body is required"
        });
      }

      const { encryptedPdf, password } =
        await encryptPdf(req.body);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="encrypted.pdf"',
        "X-Pdf-Password": password,
        "Cache-Control": "no-store, private",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });

      return res.status(200).end(encryptedPdf);

    } catch (error) {
      console.error(
        "PDF_ENCRYPT_FAILED",
        error.constructor?.name
      );

      return res.status(400).json({
        error: "PDF encryption failed"
      });
    }
  }
);

module.exports = router;
