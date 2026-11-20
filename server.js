"use strict";


require("dotenv").config();

const express = require("express");

const {
  createHmac,
  timingSafeEqual
} = require("node:crypto");

const {
  createLeaveFlow,
  sendTypingIndicator
} = require("./peoplehub-wa-flow");

const {
  getIdentity
} = require("./sap-ident-client");

const {
  MENU_ITEMS,
  LEAVE_MENU_ITEMS,
  createWelcomeMenu,
  createLeaveMenu,
  createNotReadyMessage
} = require("./menus");

const {
  getLeaveTypes,
  getLeaveHistory,
  getLeaveBalance,
  validateDate
} = require("./sap-leave-client");

const {
  textPayload,
  parseSelectionId,
  historyPayload,
  historyDetail,
  balancePayload
} = require("./leave-messages");

const app = express();

const PORT = process.env.PORT || 3000;

// JSON payload ve Meta imza kontrolü için raw body
app.use(express.json({
  limit: "1mb",
  verify(req, res, raw) {
    req.rawBody = Buffer.from(raw);
  }
}));

// Health endpoint
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

// Meta webhook güvenlik doğrulaması
function verifyMetaSignature(req, res, next) {
  const secret = process.env.WHATSAPP_APP_SECRET;

  if (!secret) {
    return res.status(503).send(
      "Meta app secret not configured"
    );
  }

  const provided =
    req.get("X-Hub-Signature-256") || "";

  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(req.rawBody || Buffer.alloc(0))
      .digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  ) {
    return res.sendStatus(403);
  }

  next();
}

// WhatsApp mesaj gönderimi
async function sendWhatsAppPayload(payload) {
  const token =
    process.env.WHATSAPP_ACCESS_TOKEN;

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    throw new Error(
      "WhatsApp API bilgileri eksik."
    );
  }

  const version =
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v25.0";

  const response = await fetch(
    https://graph.facebook.com/ +
    $DIL3/$DIL4/messages,
    {
      method: "POST",
      headers: {
        Authorization: Bearer $DIL5,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    console.error(
      "WHATSAPP_SEND_FAILED",
      response.status
    );

    throw new Error(
      WhatsApp HTTP $DIL0
    );
  }
}

// Tarih aralığı doğrulama
function validPeriod(period) {
  const begda = period?.["start-date"];
  const endda = period?.["end-date"];

  if (
    !validateDate(begda)

begda > endda
) {
    return null;
  }

  return {
    begda,
    endda
  };
}

function businessError(message) {
  return Object.assign(
    new Error(message),
    { code: "SAP_BUSINESS_ERROR" }
  );
}

// WhatsApp kullanıcısını SAP'de doğrula
async function requirePerson(from) {
  const person = await getIdentity(from);

  if (!person) {
    throw businessError(
      "SAP personel kaydınız bulunamadı."
    );
  }

  return person;
}

// SAP'den personele ait izin türlerini al
async function authorizedTypes(from) {
  await requirePerson(from);

  const types = await getLeaveTypes(from);

  if (!types.length) {
    throw businessError(
      "SAP sisteminde kullanılabilir izin türü bulunamadı."
    );
  }

  return types;
}

// İzin geçmişi sorgusu
async function authorizedHistory(from, ctx) {
  const dates = validPeriod({
    "start-date": ctx.begda,
    "end-date": ctx.endda
  });

  if (!dates) {
    throw businessError(
      "Tarih aralığı geçersiz."
    );
  }

  const types = await authorizedTypes(from);

  if (!types.some(type => type.id === ctx.awart)) {
    throw businessError(
      "Seçilen izin türü kullanılamıyor."
    );
  }

  return getLeaveHistory(from, ctx);
}

// WhatsApp Flow yanıtlarını işle
async function handleFlowReply(message) {
  let data;

  try {
    data = JSON.parse(
      message.interactive?.nfm_reply?.response_json ||
      "{}"
    );
  } catch {
    throw businessError(
      "Flow yanıtı okunamadı."
    );
  }

  if (data.action !== "LEAVE_FORM") {
    return;
  }

  const dates = validPeriod(data.period);

  if (!dates) {
    throw businessError(
      "İzin tarihleri geçersiz. Formu yeniden açın."
    );
  }

  const ctx = {
    ...dates,
    awart: String(data.awart || "")
  };

  // İzin geçmişi
  if (data.mode === "HISTR") {
    const records = await authorizedHistory(
      message.from,
      ctx
    );

    await sendWhatsAppPayload(
      historyPayload(
        message.from,
        records,
        ctx
      )
    );

    return;
  }

  // İzin talebi önizleme
  if (data.mode === "PREVW") {
    const person = await requirePerson(
      message.from
    );

    const types = await getLeaveTypes(
      message.from
    );

    const leave = types.find(
      item => item.id === ctx.awart
    );

    if (!leave) {
      throw businessError(
        "Seçilen izin türü kullanılamıyor."
      );
    }

    const fmt = iso =>
      iso.split("-").reverse().join(".");

    const response =
      "📝 İzin Talebi Önizlemesi\n\n" +
      Personel: $DIL0\n +
        İzin türü: $DIL1\n +
          Başlangıç: $DIL2\n +
            Bitiş: $DIL3\n\n +
              "Bilgi: SAP sisteminde henüz izin kaydı oluşturulmadı.";

    await sendWhatsAppPayload(
      textPayload(message.from, response)
    );
  }
}

// Gelen WhatsApp mesajlarını işle
async function handleMessage(message) {
  const from = message.from;

  if (message.type === "interactive") {

    // Flow tamamlandı
    if (
      message.interactive?.type === "nfm_reply"
    ) {
      return handleFlowReply(message);
    }

    const selectedId =
      message.interactive?.list_reply?.id ||
      message.interactive?.button_reply?.id;

    // İzin geçmişi kayıt seçimi ve sayfalama
    const selection = parseSelectionId(
      selectedId
    );

    if (selection) {
      const records = await authorizedHistory(
        from,
        selection.ctx
      );

      if (selection.action === "LHR") {
        if (!records[selection.index]) {
          throw businessError(
            "İzin kaydı değişti. Sorguyu yeniden yapın."
          );
        }

        await sendWhatsAppPayload(
          historyDetail(
            from,
            records[selection.index]
          )
        );
      } else {
        await sendWhatsAppPayload(
          historyPayload(
            from,
            records,
            selection.ctx,
            selection.index
          )
        );
      }

      return;
    }

    // Ana menüden izin süreçlerine giriş
    if (selectedId === "MENU_LEAVE") {
      await requirePerson(from);

      await sendWhatsAppPayload(
        createLeaveMenu(from)
      );

      return;
    }

    // İzin menüsünden ana menüye dönüş
    if (selectedId === "LEAVE_HOME") {
      const person = await requirePerson(from);

      await sendWhatsAppPayload(
        createWelcomeMenu(
          from,
          person.firstName
        )
      );

      return;
    }

    // İzin geçmişi veya izin talebi
    if (
      selectedId === "LEAVE_HISTORY" ||
      selectedId === "LEAVE_REQUEST"
    ) {
      const types = await authorizedTypes(from);

      const mode = selectedId === "LEAVE_HISTORY"
        ? "HISTR"
        : "PREVW";

      await sendWhatsAppPayload(
        createLeaveFlow(from, mode, types)
      );

      return;
    }

    // İzin bakiyesi
    if (selectedId === "LEAVE_BALANCE") {
      await requirePerson(from);

      const balance = await getLeaveBalance(from);

      await sendWhatsAppPayload(
        balancePayload(from, balance)
      );

      return;
    }

    // Henüz aktif olmayan izin işlemleri
    if (
      LEAVE_MENU_ITEMS.some(
        item => item.id === selectedId
      )
    ) {
      await sendWhatsAppPayload(
        createLeaveMenu(
          from,
          "Bu HR işlemi henüz kullanıma açılmadı."
        )
      );

      return;
    }

    // Diğer HR menüleri
    if (
      MENU_ITEMS.some(
        item => item.id === selectedId
      )
    ) {
      await sendWhatsAppPayload(
        createNotReadyMessage(from)
      );
    }

    return;
  }

  // Metin mesajları
  if (message.type !== "text") {
    return;
  }

  const person = await getIdentity(from);

  if (!person) {
    await sendWhatsAppPayload(
      textPayload(
        from,
        "Telefon numaranız SAP personel kayıtlarında bulunamadı."
      )
    );

    return;
  }

  await sendWhatsAppPayload(
    createWelcomeMenu(
      from,
      person.firstName
    )
  );
}

// Basit webhook tekrar işleme koruması
const processed = new Map();

app.post(
  "/webhook",
  verifyMetaSignature,
  (req, res) => {

    res.sendStatus(200);

    const entries = Array.isArray(
      req.body.entry
    ) ? req.body.entry : [];

    const messages = entries.flatMap(
      entry => (entry.changes[]).flatMap(

      )
    );

    for (const message of messages) {

      if (
        !message?.from

processed.has(message.id)
) {
  continue;
}

processed.set(
  message.id,
  Date.now()
);

if (processed.size > 5000) {
  for (const [id, timestamp] of processed) {
    if (
      Date.now() - timestamp > 600000
    ) {
      processed.delete(id);
    }
  }
}

if (
  message.type === "text" ||
  message.type === "interactive"
) {
  sendTypingIndicator(
    message.id
  ).catch(err => {
    console.error(
      "TYPING_ERROR",
      err.message
    );
  });
}

handleMessage(message).catch(
  async err => {
    console.error(
      "WHATSAPP_PROCESS_ERROR",
      err.message
    );

    const reply =
      err.code === "SAP_BUSINESS_ERROR"
        ? err.message
        : "İşleminiz şu anda gerçekleştirilemiyor.";

    try {
      await sendWhatsAppPayload(
        textPayload(
          message.from,
          reply
        )
      );
    } catch (sendErr) {
      console.error(
        "WHATSAPP_ERROR_REPLY_FAILED",
        sendErr.message
      );
    }
  }
);
}
}
);

if (require.main === module) {
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        WhatsApp Support API running on port $DIL0
      );
    }
  );
}

module.exports = {
  app,
  handleMessage,
  sendWhatsAppPayload
};