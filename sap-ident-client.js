"use strict";
const { parsePhoneNumberFromString } = require("libphonenumber-js");
async function getIdentity(whatsappNumber) {
  const base = process.env.SAP_ODATA_BASE_URL;
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;
if (!base || !username || !password) {
  throw new Error("SAP bağlantı bilgileri eksik.");
}

// WhatsApp gönderen numarasından ülke kodunu otomatik belirle
const digits = String(whatsappNumber).replace(/\D/g, "");

const parsed = parsePhoneNumberFromString(`+${digits}`);

if (!parsed || !parsed.isValid()) {
  throw new Error("Geçersiz WhatsApp numarası.");
}

// Dinamik ülke kodu ve telefon numarası
const dialc = `+${parsed.countryCallingCode}`;
const phone = parsed.nationalNumber;

if (dialc.length > 4 || phone.length > 14) {
  throw new Error("SAP telefon alanı uzunluğu aşıldı.");
}


  const root = new URL(base.endsWith("/") ? base : base + "/");

  if (root.protocol !== "https:") {
    throw new Error("SAP bağlantısı HTTPS olmalı.");
  }

  const key = `IdentSet(Dialc='${encodeURIComponent(dialc)}',Phone='${phone}')`;
  const url = new URL(key, root);

  url.searchParams.set("$format", "json");
  url.searchParams.set("sap-client", process.env.SAP_CLIENT || "100");

  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`SAP IdentSet HTTP ${response.status}`);
  }

  const data = await response.json();
  const person = data.d;

  // SAP business error: STATX = E
  if (String(person?.Statx ?? "").trim().toUpperCase() === "E") {
    const message = String(person.Mesag ?? "").trim()
      || "SAP işlemi gerçekleştirilemedi.";

    const error = new Error(message);
    error.code = "SAP_BUSINESS_ERROR";
    throw error;
  }

  if (!person || !person.Fname) {
    throw new Error("SAP personel bilgisi eksik.");
  }

  return {
    pernr: person.Pernr,
    firstName: person.Fname,
    lastName: person.Lname,
    fullName: person.Fulln
  };
}

module.exports = { getIdentity };
