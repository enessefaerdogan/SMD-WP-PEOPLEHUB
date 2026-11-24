"use strict";

function payrollConfirmationPayload(
  to,
  message,
  requestId
) {
  const text = String(message ?? "").trim();

  if (!text) {
    throw new Error("PAYROLL_CONFIRMATION_MESSAGE_EMPTY");
  }

  const body =
    "📄 *Bordro Gönderim Onayı*\n\n" + text;

  if (body.length > 1024) {
    throw new Error("PAYROLL_CONFIRMATION_MESSAGE_TOO_LONG");
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: body
      },
      footer: {
        text: "Onay süresi: 5 dakika"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `PAYROLL_YES:${requestId}`,
              title: "✅ Onayla"
            }
          },
          {
            type: "reply",
            reply: {
              id: `PAYROLL_NO:${requestId}`,
              title: "❌ Reddet"
            }
          }
        ]
      }
    }
  };
}

module.exports = {
  payrollConfirmationPayload
};
