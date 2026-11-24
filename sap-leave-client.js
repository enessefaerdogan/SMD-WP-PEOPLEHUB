
"use strict";

const {
  parsePhoneNumberFromString
} = require("libphonenumber-js");

// SAP bağlantı ayarları
function getSapSettings() {
  const base = process.env.SAP_ODATA_BASE_URL;
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;

  if (!base || !username || !password) {
    throw new Error("SAP bağlantı bilgileri eksik.");
  }

  const root = new URL(
    base.endsWith("/") ? base : `${base}/`
  );

  if (root.protocol !== "https:") {
    throw new Error("SAP bağlantısı HTTPS olmalı.");
  }

  if (
    !root.pathname.endsWith(
      "/ZSMD_UX_WHATSAPP_SRV/"
    )
  ) {
    throw new Error(
      "SAP_ODATA_BASE_URL, " +
      "ZSMD_UX_WHATSAPP_SRV kökünü göstermeli."
    );
  }

  const auth = Buffer.from(
    `${username}:${password}`
  ).toString("base64");

  return {
    root,
    authorization: `Basic ${auth}`
  };
}

// WhatsApp numarasından ulusal numarayı bul
function getSapPhone(whatsappNumber) {
  const digits = String(
    whatsappNumber || ""
  ).replace(/\D/g, "");

  const parsed = parsePhoneNumberFromString(
    `+${digits}`
  );

  if (!parsed || !parsed.isValid()) {
    throw new Error("Geçersiz WhatsApp numarası.");
  }

  return parsed.nationalNumber;
}

// OData string literal
function quoteOData(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Gerçek tarih kontrolü
function validateDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) {
    return false;
  }

  const date = new Date(`${iso}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
  );
}

// OData tarih literal
function dateLiteral(iso) {
  if (!validateDate(iso)) {
    throw new Error("Geçersiz tarih.");
  }

  if (
    process.env.SAP_LEAVE_DATE_TYPE === "string"
  ) {
    return quoteOData(iso.replaceAll("-", ""));
  }

  return `datetime'${iso}T00:00:00'`;
}

// Phone ve Reqid anahtarlarını oluştur
function createKeyPath(phone, reqid) {
  if (!/^[A-Z]{5}$/.test(reqid)) {
    throw new Error("Geçersiz Reqid.");
  }

  return (
    `LeaveSet(` +
    `Phone=${quoteOData(phone)},` +
    `Reqid=${quoteOData(reqid)}` +
    `)`
  );
}

// SAP metadata'daki navigation adı

// BALNC: GET_ENTITY
function makeKeyUrl(root, phone, reqid) {
  const url = new URL(
    createKeyPath(phone, reqid),
    root
  );

  url.searchParams.set("$format", "json");
  url.searchParams.set(
    "sap-client",
    process.env.SAP_CLIENT || "100"
  );

  return url;
}

// AWART ve HISTR: navigation GET_ENTITYSET
function makeCollectionUrl(root, phone, reqid, filter) {
  const url = new URL("LeaveSet", root);

  const filters = [
    `Phone eq ${quoteOData(phone)}`,
    `Reqid eq ${quoteOData(reqid)}`
  ];

  if (filter) {
    filters.push(filter);
  }

  url.searchParams.set("$filter", filters.join(" and "));
  url.searchParams.set("$format", "json");
  url.searchParams.set(
    "sap-client",
    process.env.SAP_CLIENT || "100"
  );

  url.searchParams.set("sap-language", "TR");
  return url;
}

// SAP GET isteği
async function requestJson(url, authorization) {
  const startedAt = Date.now();

  const safePath = decodeURIComponent(url.pathname)
    .replace(/Phone='[^']*'/gi, "Phone='***'");

  console.log("SAP_LEAVE_REQUEST:", safePath);
  console.log("SAP_LEAVE_CLIENT:", url.searchParams.get("sap-client"));

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authorization,
        Accept: "application/json"
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000)
    });

    console.log("SAP_LEAVE_STATUS:", response.status);
    console.log("SAP_LEAVE_DURATION_MS:", Date.now() - startedAt);

    if (!response.ok) {
      const body = await response.json().catch(() => null);

      console.error(
        "SAP_LEAVE_ERROR_CODE:",
        body?.error?.code || "UNKNOWN"
      );

      throw new Error(
        `SAP LeaveSet HTTP ${response.status}`
      );
    }

    return await response.json();

  } catch (error) {
    console.error(
      "SAP_LEAVE_REQUEST_FAILED:",
      error.message
    );
    throw error;
  }
}

// Çok sayfalı OData V2 yanıtlarını birleştir
async function readCollection(
  url,
  root,
  authorization
) {
  const records = [];
  const seen = new Set();

  while (url) {
    if (seen.has(url.href)) {
      throw new Error(
        "SAP OData sayfalama döngüsü oluştu."
      );
    }

    seen.add(url.href);

    const json = await requestJson(
      url,
      authorization
    );

    const page = json?.d?.results;

    if (!Array.isArray(page)) {
      throw new Error(
        "SAP OData koleksiyon yanıtı liste değil."
      );
    }

    records.push(...page);

    if (records.length > 2000) {
      throw new Error(
        "Çok fazla izin kaydı. Tarih aralığını daraltın."
      );
    }

    const next = json?.d?.__next;

    if (!next) {
      break;
    }

    const candidate = new URL(next, root);

    if (
      candidate.origin !== root.origin ||
      !candidate.pathname.startsWith(root.pathname)
    ) {
      throw new Error(
        "SAP güvenli olmayan sayfalama adresi döndürdü."
      );
    }

    url = candidate;
  }

  return records;
}

// AWART — izin türleri
async function getLeaveTypes(whatsappNumber) {
  const { root, authorization } = getSapSettings();
  const phone = getSapPhone(whatsappNumber);

  const url = makeCollectionUrl(
    root,
    phone,
    "AWART"
  );

  const records = await readCollection(
    url,
    root,
    authorization
  );

  const used = new Set();

  return records.flatMap(record => {
    const id = String(
      record.Awart ?? ""
    ).trim();

    const title = String(
      record.Atext ?? ""
    ).trim();

    if (
      !/^\d{4}$/.test(id) ||
      !title ||
      used.has(id)
    ) {
      return [];
    }

    used.add(id);

    return [{
      id,
      title: title.slice(0, 30)
    }];
  });
}

// HISTR — izin geçmişi
async function getLeaveHistory(
  whatsappNumber,
  { awart, begda, endda }
) {
  const leaveType = String(awart ?? "").trim();

  if (
    leaveType !== "ALL" &&
    !/^\d{4}$/.test(leaveType)
  ) {
    throw new Error("Geçersiz izin türü.");
  }

  if (
    !validateDate(begda) ||
    !validateDate(endda) ||
    begda > endda
  ) {
    throw new Error("Geçersiz tarih aralığı.");
  }

  const { root, authorization } = getSapSettings();
  const phone = getSapPhone(whatsappNumber);

  const filters = [
    `Begda eq ${dateLiteral(begda)}`,
    `Endda eq ${dateLiteral(endda)}`
  ];

  if (leaveType !== "ALL") {
    filters.push(
      `Awart eq ${quoteOData(leaveType)}`
    );
  }

  const url = makeCollectionUrl(
    root,
    phone,
    "HISTR",
    filters.join(" and ")
  );

  return readCollection(
    url,
    root,
    authorization
  );
}

// BALNC — izin bakiyesi
async function getLeaveBalance(whatsappNumber) {
  const { root, authorization } = getSapSettings();
  const phone = getSapPhone(whatsappNumber);

  const url = makeKeyUrl(
    root,
    phone,
    "BALNC"
  );

  const json = await requestJson(
    url,
    authorization
  );

  if (
    !json?.d ||
    json.d.Balnc == null
  ) {
    throw new Error(
      "SAP izin bakiyesi bulunamadı."
    );
  }

  return json.d;
}

module.exports = {
  getSapPhone,
  getLeaveTypes,
  getLeaveHistory,
  getLeaveBalance,
  validateDate,
  createKeyPath,
  makeKeyUrl,
  makeCollectionUrl
};
