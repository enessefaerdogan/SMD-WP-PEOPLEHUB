"use strict";


const {
  randomUUID
} = require("node:crypto");

// Mevcut genel PeopleHub Flow
function createPeopleHubFlow(
  to,
  screen = "HOME",
  data
) {
  const flowId = String(
    process.env.WHATSAPP_FLOW_ID || ""
  ).trim();

  if (!/^\d+$/.test(flowId)) {
    throw new Error(
      "WHATSAPP_FLOW_ID ayarlanmamış."
    );
  }

  const flowActionPayload = { screen };

  if (data) {
    flowActionPayload.data = data;
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: {
        type: "text",
        text: "SMOD PeopleHub"
      },
      body: {
        text:
          "İnsan kaynakları işlemlerinize " +
          "WhatsApp içinden erişin."
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: randomUUID(),
          flow_id: flowId,
          flow_cta: "PeopleHub'ı Aç",
          flow_action: "navigate",
          flow_action_payload:
            flowActionPayload
        }
      }
    }
  };
}

// Yeni dinamik izin Flow
function createLeaveFlow(
  to,
  mode,
  leaveTypes
) {
  if (
    !["HISTR", "PREVW"].includes(mode)
  ) {
    throw new Error(
      "Geçersiz Flow işlem kodu."
    );
  }

  if (
    !Array.isArray(leaveTypes) ||
    !leaveTypes.length
  ) {
    throw new Error(
      "İzin türü bulunamadı."
    );
  }

  const flowId = String(
    process.env.WHATSAPP_LEAVE_FLOW_ID || ""
  ).trim();

  if (!/^\d+$/.test(flowId)) {
    throw new Error(
      "WHATSAPP_LEAVE_FLOW_ID ayarlanmamış."
    );
  }

  const title = mode === "HISTR"
    ? "İzin Geçmişim"
    : "İzin Talebi Önizleme";

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: {
        type: "text",
        text: "SMOD PeopleHub"
      },
      body: {
        text: title + ": izin türünü ve tarihlerini seçin."
      },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_token: randomUUID(),
        flow_id: flowId,
        flow_cta: "İzin Formunu Aç",
        flow_action: "navigate",
        flow_action_payload: {
          screen: "LEAVE_FORM",
          data: {
            leave_types: leaveTypes,
            mode,
            heading: title,
            hint: mode === "PREVW"
              ? (
                "Bu işlem yalnızca önizlemedir, " +
                "SAP'ye izin kaydı oluşturulmaz."
              )
              : (
                "İzin türünü ve sorgulamak " +
                "istediğiniz tarih aralığını seçin."
              )
          }
        }
      }
    }
  }
};
}

// WhatsApp yazıyor göstergesi
async function sendTypingIndicator(messageId) {
  if (!messageId) {
    return;
  }

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN;

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return;
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
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: {
          type: "text"
        }
      }),
      signal: AbortSignal.timeout(5000)
    }
  );

  if (!response.ok) {
    console.error(
      "WHATSAPP_TYPING_FAILED",
      response.status
    );
  }
}

module.exports = {
  createPeopleHubFlow,
  createLeaveFlow,
  sendTypingIndicator
};