
"use strict";

const NAV_ACTIONS = Object.freeze({
  HOME: "NAV_HOME",
  END: "NAV_END"
});

// Ortak işlem sonucu mesajı
function resultPayload(to, body) {
  const text = String(body ?? "").trim();

  if (!text || text.length > 1024) {
    throw new Error("Geçersiz işlem sonuç mesajı.");
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: NAV_ACTIONS.HOME,
              title: "🏠 Ana Menü"
            }
          },
          {
            type: "reply",
            reply: {
              id: NAV_ACTIONS.END,
              title: "👋 İşlemi Sonlandır"
            }
          }
        ]
      }
    }
  };
}

// İşlem sonlandırma mesajı
function endPayload(to) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      body:
        "İşleminiz sonlandırıldı.\n\n" +
        "Yeni bir işlem yapmak için mesaj gönderebilirsiniz.\n\n" +
        "İyi günler dileriz."
    }
  };
}

// Ortak navigasyon aksiyonunu belirle
function parseNavigationAction(id) {
  if (id === NAV_ACTIONS.HOME) {
    return "HOME";
  }

  if (id === NAV_ACTIONS.END) {
    return "END";
  }

  return null;
}

module.exports = {
  NAV_ACTIONS,
  resultPayload,
  endPayload,
  parseNavigationAction
};