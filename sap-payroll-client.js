"use strict";

const { getSapPhone } = require("./sap-leave-client");

const ENTITY_SET = "PayrollSet";
const GET_TIMEOUT_MS = 30000;
const CREATE_TIMEOUT_MS = 120000;

function settings() {
  const baseUrl =
    process.env.SAP_PAYROLL_SERVICE_URL ||
    process.env.SAP_ODATA_BASE_URL;

  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error("SAP_PAYROLL_CONFIG_MISSING");
  }

  const root = new URL(
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
  );

  if (root.protocol !== "https:") {
    throw new Error("SAP_PAYROLL_HTTPS_REQUIRED");
  }

  const authorization =
    "Basic " +
    Buffer.from(`${username}:${password}`).toString("base64");

  function url(path = "", method = "GET") {
    const target = new URL(path, root);

    target.searchParams.set(
      "sap-client",
      process.env.SAP_CLIENT || "100"
    );

    target.searchParams.set(
      "sap-language",
      process.env.SAP_LANGUAGE || "TR"
    );

    if (method === "GET") {
      target.searchParams.set("$format", "json");
    } else {
      target.searchParams.delete("$format");
    }

    return target;
  }

  return { url, authorization };
}

function validatePeriod(year, month) {
  if (
    !/^\d{4}$/.test(String(year)) ||
    !/^(0[1-9]|1[0-2])$/.test(String(month))
  ) {
    throw new Error("SAP_PAYROLL_INVALID_PERIOD");
  }
}

function odataString(value) {
  return encodeURIComponent(
    String(value).replace(/'/g, "''")
  );
}

async function parseOData(response) {
  if (!response.ok) {
    throw new Error(
      `SAP_PAYROLL_HTTP_${response.status}`
    );
  }

  const text = await response.text();

  if (!text) {
    throw new Error("SAP_PAYROLL_EMPTY_RESPONSE");
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("SAP_PAYROLL_INVALID_JSON");
  }

  const result = parsed.d ?? parsed;

  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Array.isArray(result.results)
  ) {
    throw new Error("SAP_PAYROLL_INVALID_RESPONSE");
  }

  return result;
}

// ==========================================
// GET_ENTITY: Bordro uygunluk kontrolü
// ==========================================

async function getPayrollConfirmation(
  whatsappNumber,
  year,
  month
) {
  validatePeriod(year, month);

  const phone = getSapPhone(whatsappNumber);
  const { url, authorization } = settings();

  const key = [
    `Phone='${odataString(phone)}'`,
    `Pabrj='${odataString(year)}'`,
    `Pabrp='${odataString(month)}'`
  ].join(",");

  console.log("SAP_PAYROLL_GET_STARTED");

  const response = await fetch(
    url(`${ENTITY_SET}(${key})`),
    {
      method: "GET",
      headers: {
        Authorization: authorization,
        Accept: "application/json"
      },
      redirect: "error",
      signal: AbortSignal.timeout(GET_TIMEOUT_MS)
    }
  );

  console.log(
    "SAP_PAYROLL_GET_STATUS:",
    response.status
  );

  const result = await parseOData(response);

  console.log(
    "SAP_PAYROLL_GET_STATX:",
    String(result.Statx || "").trim()
  );

  return result;
}

// ==========================================
// CREATE_ENTITY: Bordro gönderimi
// ==========================================

async function createPayroll({
  phone,
  pabrj,
  pabrp,
  confn = false
}) {
  if (confn !== true) {
    throw new Error("SAP_PAYROLL_CONFIRMATION_REQUIRED");
  }

  if (
    process.env.SAP_PAYROLL_ENABLE_CREATE !== "true"
  ) {
    throw new Error("SAP_PAYROLL_CREATE_DISABLED");
  }

  validatePeriod(pabrj, pabrp);

  const sapPhone = getSapPhone(phone);
  const { url, authorization } = settings();

  // CSRF token ve oturum cookie bilgilerini al
  const csrfResponse = await fetch(
    url(),
    {
      method: "GET",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "X-CSRF-Token": "Fetch"
      },
      redirect: "error",
      signal: AbortSignal.timeout(GET_TIMEOUT_MS)
    }
  );

  if (!csrfResponse.ok) {
    throw new Error(
      `SAP_PAYROLL_CSRF_HTTP_${csrfResponse.status}`
    );
  }

  const csrfToken =
    csrfResponse.headers.get("x-csrf-token");

  if (
    !csrfToken ||
    csrfToken.toLowerCase() === "required"
  ) {
    throw new Error("SAP_PAYROLL_CSRF_MISSING");
  }

  const cookies = (
    csrfResponse.headers.getSetCookie?.() || []
  )
    .map(cookie => cookie.split(";")[0])
    .join("; ");

  // CSRF response içeriğini tüket
  await csrfResponse.arrayBuffer();

  // SAP'ye yalnızca gerekli üç alan gönderilir
  const payload = {
    Phone: sapPhone,
    Pabrj: String(pabrj),
    Pabrp: String(pabrp),
    Confn: confn
  };

  console.log("SAP_PAYROLL_CREATE_STARTED");

  const response = await fetch(
    url(ENTITY_SET, "POST"),
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "X-CSRF-Token": csrfToken,
        ...(cookies ? { Cookie: cookies } : {}),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS)
    }
  );

  console.log(
    "SAP_PAYROLL_CREATE_STATUS:",
    response.status
  );

  const result = await parseOData(response);

  console.log(
    "SAP_PAYROLL_CREATE_STATX:",
    String(result.Statx || "").trim()
  );

  return result;
}

module.exports = {
  getPayrollConfirmation,
  createPayroll
};
