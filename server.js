require("dotenv").config();
const express = require("express");
const { getSapData } = require("./sap-odata-direct");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "WhatsApp Support API"
  });
});

// Meta webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Send message using Meta Graph API
async function sendWhatsAppMessage(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    console.log("WhatsApp API credentials missing");
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text
        }
      })
    }
  );

  if (!response.ok) {
    console.error("WhatsApp send failed:", response.status, await response.text());
    return;
  }

  console.log("Automatic WhatsApp reply accepted");
}

// Incoming messages
app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  const message =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message || message.type !== "text") return;

  console.log("Incoming WhatsApp message:", message.id);

  const command = message.text?.body?.trim();

  async function handleMessage() {
    let reply;

    if (command === "1") {
      try {
        const records = await getSapData("TestDataSet");

        const lines = records.slice(0, 10).map(record =>
          `${record.Id} - ${record.Name} - ${record.Status}`
        );

        reply = lines.length
          ? "SAP Test Kayıtları:\n\n" + lines.join("\n")
          : "SAP sisteminde kayıt bulunamadı.";

      } catch (err) {
        console.error("SAP OData error:", err.message);
        reply = "SAP test verileri şu anda alınamıyor.";
      }

    } else {
      reply =
        "SAP Destek Sistemine Hoş Geldiniz!\n\n" +
        "1 - SAP Test Kayıtlarını Listele\n\n" +
        "Lütfen işlem numarasını gönderin.";
    }

    await sendWhatsAppMessage(message.from, reply);
  }

  handleMessage().catch(err =>
    console.error("WhatsApp reply error:", err.message)
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Support API running on port ${PORT}`);
});