"use strict";

require("dotenv").config();

const express = require("express");

const {
  createHmac,
  timingSafeEqual,
  randomUUID
} = require("node:crypto");

const {
  createPeopleHubFlow,
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


const {
  payrollConfirmationPayload
} = require("./payroll-confirmation");

const {
  getPayrollConfirmation,
  createPayroll
} = require("./sap-payroll-client");

// Bekleyen bordro onayları
const pendingPayroll = new Map();

const PAYROLL_CONFIRM_TTL = 5 * 60 * 1000;

const {
  resultPayload,
  endPayload,
  parseNavigationAction
} = require("./navigation-messages");

const app = express();

const pdfEncryptRouter = require("./pdf-encrypt-route");

app.use(pdfEncryptRouter);

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
    "https://graph.facebook.com/" + version + "/" + phoneId + "/messages",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
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

    throw new Error("WhatsApp HTTP " + response.status);
  }
}

// Tarih aralığı doğrulama
function validPeriod(period) {
  const begda = period?.["start-date"];
  const endda = period?.["end-date"];

  if (!validateDate(begda) || !validateDate(endda) || begda > endda) {
    return null;
  }

  return {
    begda,
    endda
  };
}

// Kişiselleştirilmiş ana menü
function createPersonalizedPeopleHubFlow(to, person) {
  const name = String(
    person?.fullName || person?.firstName || ""
  ).replace(/[\r\n\t*`_~]/g, " ").trim();

  const payload = createPeopleHubFlow(to);

  payload.interactive.header = {
    type: "text",
    text: "İK İşlem Merkezi"
  };

  payload.interactive.body = {
    text:
      (name ? `Merhaba, *${name}*.` : "Merhaba.") +
      "\n\nİnsan kaynakları işlemleriniz için aşağıdaki menüyü kullanabilirsiniz."
  };

  payload.interactive.action.parameters.flow_cta =
    "İşlemlerimi Aç";

  return payload;
}

// Ana menü için personel ve izin türlerini paralel al
async function sendPeopleHubHome(from) {
  const [person, leaveTypes] = await Promise.all([
    getIdentity(from),
    getLeaveTypes(from).catch(() => {
      console.error("SAP_LEAVE_TYPES_LOAD_FAILED");
      return [];
    })
  ]);

  if (!person) {
    await sendWhatsAppPayload(
      textPayload(
        from,
        "Telefon numaranız SAP personel kayıtlarında bulunamadı."
      )
    );
    return;
  }

  const ready = leaveTypes.length > 0 &&
                leaveTypes.length <= 199;

  const payload = createPersonalizedPeopleHubFlow(
    from,
    person
  );

  payload.interactive.action.parameters
    .flow_action_payload.data = {
      leave_types: ready
        ? [
            { id: "ALL", title: "Tüm İzinler" },
            ...leaveTypes.filter(item => item.id !== "ALL")
          ]
        : [{
            id: "UNAVAILABLE",
            title: "İzin türleri alınamadı"
          }],
      leave_types_ready: ready,
      leave_history_hint: ready
        ? "İzin türünü ve tarih aralığını seçin."
        : "İzin türleri şu anda kullanılamıyor. Daha sonra tekrar deneyin."
    };

  console.log(
    "PEOPLEHUB_LEAVE_TYPES_COUNT:",
    leaveTypes.length
  );

  await sendWhatsAppPayload(payload);
}

// İzin geçmişi sonuçlarına ortak navigasyon ekle
async function sendHistoryWithNavigation(to, payload) {
  if (
    payload.type === "text" &&
    payload.text?.body &&
    payload.text.body.length <= 1024
  ) {
    await sendWhatsAppPayload(
      resultPayload(to, payload.text.body)
    );
    return;
  }

  await sendWhatsAppPayload(payload);

  await sendWhatsAppPayload(
    resultPayload(
      to,
      "Başka bir işlem yapmak ister misiniz?"
    )
  );
}

const {
  historyTablePayloads
} = require("./leave-messages");

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

  if (ctx.awart === "ALL") {
    await requirePerson(from);
  } else {
    const types = await authorizedTypes(from);

    if (!types.some(type => type.id === ctx.awart)) {
      throw businessError(
        "Seçilen izin türü kullanılamıyor."
      );
    }
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


if (data.action === "LEAVE_BALANCE") {
  const from = message.from;

  // SAP LeaveSet üzerinden bakiye sorgula
  const balance = await getLeaveBalance(from);

  // Sonucu yeni WhatsApp mesajında göster
  await sendWhatsAppPayload(
    balancePayload(from, balance)
  );

  return;
}



// Bordro sorgulama - SAP GET_ENTITY
if (data.action === "PAYROLL_REQUEST") {
    const from = message.from;

    const year = String(
      data.pabrj ?? data.year ?? ""
    ).trim();

    const month = String(
      data.pabrp ?? data.month ?? ""
    ).trim().padStart(2, "0");

    if (
      !/^\d{4}$/.test(year) ||
      !/^(0[1-9]|1[0-2])$/.test(month)
    ) {
      await sendWhatsAppPayload(
        resultPayload(
          from,
          "Geçersiz bordro dönemi."
        )
      );
      return;
    }

    // Personel doğrulaması
    await requirePerson(from);

    let result;

    try {
      result = await getPayrollConfirmation(
        from,
        year,
        month
      );
    } catch (error) {
      console.error(
        "SAP_PAYROLL_GET_FAILED",
        error.message
      );

      await sendWhatsAppPayload(
        resultPayload(
          from,
          "Bordro sorgusu şu anda gerçekleştirilemiyor."
        )
      );

      return;
    }

    const status =
      String(result?.Statx ?? "").trim();

    const sapMessage =
      String(result?.Mesag ?? "").trim();

    // C değilse onay ekranı açılmaz
    if (status !== "C") {
      await sendWhatsAppPayload(
        resultPayload(
          from,
          sapMessage ||
          "Bordro sorgusu tamamlanamadı."
        )
      );
      return;
    }

    if (!sapMessage) {
      await sendWhatsAppPayload(
        resultPayload(
          from,
          "SAP bordro onay mesajı alınamadı."
        )
      );
      return;
    }

    // Süresi dolmuş ve bu kullanıcıya ait
    // önceki onay kayıtlarını temizle
    const now = Date.now();

    for (const [id, pending] of pendingPayroll) {
      if (
        pending.expiresAt <= now ||
        pending.from === from
      ) {
        pendingPayroll.delete(id);
      }
    }

    const requestId = randomUUID();

    // Parola veya GET response saklanmaz
    pendingPayroll.set(requestId, {
      from,
      year,
      month,
      expiresAt: now + PAYROLL_CONFIRM_TTL
    });

    try {
      await sendWhatsAppPayload(
        payrollConfirmationPayload(
          from,
          sapMessage,
          requestId
        )
      );
    } catch (error) {
      pendingPayroll.delete(requestId);
      throw error;
    }

    return;
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
    const from = message.from;

    const records = await authorizedHistory(
      from,
      ctx
    );

    const { historyTablePayloads } =
      require("./leave-messages");

    const payloads = historyTablePayloads(
      from,
      records,
      ctx
    );

    for (const payload of payloads) {
      await sendWhatsAppPayload(payload);
    }

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

    const response = [
      "📝 İzin Talebi Önizlemesi", "",
      "Personel: " + (person.fullName || person.firstName || ""),
      "İzin türü: " + (leave.title || ctx.awart),
      "Başlangıç: " + fmt(ctx.begda),
      "Bitiş: " + fmt(ctx.endda), "",
      "Bilgi: SAP sisteminde henüz izin kaydı oluşturulmadı."
    ].join("\n");

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

    // Merkezi navigasyon yönetimi
    const navAction = parseNavigationAction(selectedId);

    if (navAction === "HOME") {
      await sendPeopleHubHome(from);
      return;
    }

    if (navAction === "END") {
      await sendWhatsAppPayload(endPayload(from));

      return;
    }




// Bordro Evet / Hayır işlemi
const payrollDecision =
      /^PAYROLL_(YES|NO):([a-f0-9-]{36})$/i.exec(
        selectedId || ""
      );

    if (payrollDecision) {
      const approved =
        payrollDecision[1].toUpperCase() === "YES";

      const requestId = payrollDecision[2];
      const pending = pendingPayroll.get(requestId);

      // Onay yalnızca ilgili kullanıcıya aittir
      if (!pending || pending.from !== from) {
        await sendWhatsAppPayload(
          resultPayload(
            from,
            "Bordro onayı geçersiz veya daha önce kullanılmış."
          )
        );

        return;
      }

      if (Date.now() >= pending.expiresAt) {
        pendingPayroll.delete(requestId);

        await sendWhatsAppPayload(
          resultPayload(
            from,
            "Bordro onayının süresi doldu. Lütfen yeniden sorgulayın."
          )
        );

        return;
      }

      // Her onay yalnızca bir kez kullanılabilir
      pendingPayroll.delete(requestId);

      // REDDET: SAP'ye hiçbir istek gönderilmez
      if (!approved) {
        console.log("PAYROLL_REQUEST_REJECTED");

        await sendWhatsAppPayload(
          resultPayload(
            from,
            "Bordro gönderim talebiniz iptal edildi."
          )
        );

        return;
      }

      // ONAYLA: SAP CREATE_ENTITY
      let result;

      try {
        await requirePerson(from);

        result = await createPayroll({
          phone: from,
          pabrj: pending.year,
          pabrp: pending.month,
          confn: approved
        });

      } catch (error) {
        console.error(
          "SAP_PAYROLL_CREATE_FAILED",
          error.message
        );

        const errorMessage =
          error.message === "SAP_PAYROLL_CREATE_DISABLED"
            ? "Bordro gönderimi şu anda etkin değil."
            : "Bordro gönderim sonucu doğrulanamadı. Tekrar işlem yapmadan önce e-posta adresinizi kontrol edin.";

        await sendWhatsAppPayload(
          resultPayload(
            from,
            errorMessage
          )
        );

        return;
      }

      const sapMessage =
        String(result?.Mesag ?? "").trim();

      // SAP mesajını doğrudan göster
      await sendWhatsAppPayload(
        resultPayload(
          from,
          sapMessage ||
          "SAP bordro gönderim sonucu doğrulanamadı."
        )
      );

      return;
    }


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

        await sendHistoryWithNavigation(
        message.from,
        historyDetail(
            from,
            records[selection.index]
          )
        );
      } else {
        await sendHistoryWithNavigation(
        message.from,
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
      await sendPeopleHubHome(from);
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

  await sendPeopleHubHome(from);
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

    const messages = entries.flatMap(entry =>
      (entry.changes || []).flatMap(change => change.value?.messages || [])
    );

    for (const message of messages) {

      if (!message?.from || !message?.id || processed.has(message.id)) {
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
        "WhatsApp Support API running on port " + PORT
      );
    }
  );
}

module.exports = {
  app,
  handleMessage,
  sendWhatsAppPayload
};