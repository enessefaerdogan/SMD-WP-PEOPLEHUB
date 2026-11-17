const SAP_BASE_URL =
  "https://sandbox.smod.com.tr/sap/opu/odata/sap/ZMCP_TEST_SRV_SRV/";

async function getSapData(entitySet) {
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;

  if (!username || !password) {
    throw new Error("SAP kimlik bilgileri eksik.");
  }

  const url = new URL(entitySet, SAP_BASE_URL);

  if (
    url.origin !== new URL(SAP_BASE_URL).origin ||
    !url.pathname.startsWith(new URL(SAP_BASE_URL).pathname)
  ) {
    throw new Error("Geçersiz OData adresi.");
  }

  url.searchParams.set("$format", "json");
  url.searchParams.set("sap-client", "100");

  const auth = Buffer.from(
    `${username}:${password}`
  ).toString("base64");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`SAP OData HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.d?.results ?? [];
}

module.exports = { getSapData };

if (require.main === module) {
  getSapData("TestDataSet")
    .then(records => {
      console.table(records.map(({ Id, Name, Status }) => ({
        Id, Name, Status
      })));
    })
    .catch(err => {
      console.error("SAP OData hatası:", err.message);
      process.exitCode = 1;
    });
}
