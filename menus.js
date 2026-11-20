
"use strict";

const MENU_ITEMS = [
  { id: "MENU_LEAVE", title: "🏖️ İzin Süreçleri" },
  { id: "MENU_PAYRL", title: "💰 Bordro ve Ücret" },
  { id: "MENU_ATTEN", title: "🕒 Mesai ve Devam" },
  { id: "MENU_PERSN", title: "👤 Özlük İşlemleri" },
  { id: "MENU_APPRV", title: "✅ Onay İşlemleri" },
  { id: "MENU_OTHER", title: "📋 Diğer HR İşlemleri" }
];

function createWelcomeMenu(to, firstName) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          `Merhaba ${firstName} 👋\n\n` +
          "SMOD İnsan Kaynakları Asistanına hoş geldin.\n\n" +
          "Hangi işlemle devam etmek istersin?"
      },
      action: {
        button: "İşlem Menüsünü Aç",
        sections: [
          {
            title: "İnsan Kaynakları",
            rows: MENU_ITEMS
          }
        ]
      }
    }
  };
}

function createNotReadyMessage(to) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body:
        "Bu HR işlemi henüz kullanıma açılmadı. " +
        "Ana menü için Merhaba yazabilirsin."
    }
  };
}

const LEAVE_MENU_ITEMS = [
  { id: "LEAVE_REQUEST", title: "📝 İzin Talep Et" },
  { id: "LEAVE_BALANCE", title: "📊 İzin Bakiyem" },
  { id: "LEAVE_HISTORY", title: "🗓️ İzin Geçmişim" },
  { id: "LEAVE_PENDING", title: "⏳ Bekleyen İzinler" },
  { id: "LEAVE_CANCEL", title: "❌ İzin İptali" },
  { id: "LEAVE_HOME", title: "⬅️ Ana Menü" }
];

function createLeaveMenu(
  to,
  intro = "Yapmak istediğiniz işlemi seçin."
) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: `*İzin Süreçleri*\n\n${intro}`
      },
      action: {
        button: "İzin Menüsünü Aç",
        sections: [
          {
            title: "İzin İşlemleri",
            rows: LEAVE_MENU_ITEMS
          }
        ]
      }
    }
  };
}

module.exports = {
  MENU_ITEMS,
  LEAVE_MENU_ITEMS,
  createWelcomeMenu,
  createLeaveMenu,
  createNotReadyMessage
};
