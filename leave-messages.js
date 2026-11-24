
"use strict";

const { resultPayload } = require("./navigation-messages");

const PAGE_SIZE = 8;

function safe(value) {
  return String(value ?? "")
    .replace(/[\r\n\t*`_~]/g, " ")
    .trim();
}

function sapDate(value) {
  const str = String(value ?? "");

  const unix = /^\/Date\((-?\d+)/.exec(str);

  if (unix) {
    const dt = new Date(Number(unix[1]));

    return Number.isNaN(dt.getTime())
      ? "?"
      : dt.toISOString().slice(0, 10);
  }

  if (/^\d{8}$/.test(str)) {
    return (
      `${str.slice(0, 4)}-` +
      `${str.slice(4, 6)}-` +
      `${str.slice(6, 8)}`
    );
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  return "?";
}

function formatDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? iso.split("-").reverse().join(".")
    : "?";
}

function textPayload(to, body) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };
}

function selectionId(prefix, ctx, index) {
  return (
    `${prefix}|${ctx.awart}|` +
    `${ctx.begda.replaceAll("-", "")}|` +
    `${ctx.endda.replaceAll("-", "")}|${index}`
  );
}

function parseSelectionId(id) {
  const parts = String(id || "").split("|");

  if (
    parts.length !== 5 ||
    !["LHR", "LHN", "LHP"].includes(parts[0])
  ) {
    return null;
  }

  const [action, awart, beg, end, val] = parts;

  if (
    !/^\d{4}$/.test(awart) ||
    !/^\d{8}$/.test(beg) ||
    !/^\d{8}$/.test(end) ||
    !/^\d{1,5}$/.test(val)
  ) {
    return null;
  }

  const begda =
    `${beg.slice(0, 4)}-` +
    `${beg.slice(4, 6)}-${beg.slice(6)}`;

  const endda =
    `${end.slice(0, 4)}-` +
    `${end.slice(4, 6)}-${end.slice(6)}`;

  return {
    action,
    ctx: { awart, begda, endda },
    index: Number(val)
  };
}

function historyPayload(
  to,
  records,
  ctx,
  page = 0
) {
  const total = records.length;

  if (!total) {
    return textPayload(
      to,
      `📅 ${formatDate(ctx.begda)} - ` +
      `${formatDate(ctx.endda)}\n` +
      "Seçilen izin türünde kayıt bulunamadı."
    );
  }

  const maxPage = Math.floor(
    (total - 1) / PAGE_SIZE
  );

  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page > maxPage
  ) {
    throw new Error(
      "Geçersiz izin listesi sayfası."
    );
  }

  const start = page * PAGE_SIZE;

  const rows = records
    .slice(start, start + PAGE_SIZE)
    .map((record, offset) => {
      const beg = formatDate(
        sapDate(record.Begda)
      );

      const end = formatDate(
        sapDate(record.Endda)
      );

      return {
        id: selectionId(
          "LHR",
          ctx,
          start + offset
        ),
        title: `${beg} - ${end}`.slice(0, 24),
        description: (
          `${safe(record.Atext || record.Awart || "İzin")}` +
          " • Detayları aç"
        ).slice(0, 72)
      };
    });

  if (page > 0) {
    rows.push({
      id: selectionId(
        "LHP",
        ctx,
        page - 1
      ),
      title: "⬅️ Önceki Sayfa"
    });
  }

  if (page < maxPage) {
    rows.push({
      id: selectionId(
        "LHN",
        ctx,
        page + 1
      ),
      title: "➡️ Sonraki Sayfa"
    });
  }

  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          "🗓️ *İzin Geçmişim*\n" +
          `${formatDate(ctx.begda)} - ` +
          `${formatDate(ctx.endda)}\n` +
          `Toplam ${total} kayıt • ` +
          `${start + 1}-${Math.min(
            total,
            start + PAGE_SIZE
          )} gösteriliyor.`
      },
      action: {
        button: "İzin Kayıtlarını Aç",
        sections: [{
          title: "İzin Kayıtları",
          rows
        }]
      }
    }
  };
}

function historyDetail(to, record) {
  return textPayload(
    to,
    "🗓️ *İzin Detayı*\n\n" +
    `İzin türü: ${safe(
      record.Atext || record.Awart
    )}\n` +
    `Başlangıç: ${formatDate(
      sapDate(record.Begda)
    )}\n` +
    `Bitiş: ${formatDate(
      sapDate(record.Endda)
    )}`
  );
}

function formatDays(value) {
  if (value == null || String(value).trim() === "") {
    return "Belirtilmemiş";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Belirtilmemiş";
  }

  return number.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 5
  }) + " gün";
}

function balancePayload(to, balance) {
  return resultPayload(
    to,
    "📊 *İzin Bakiyem*\n\n" +
    `Toplam İzin: *${formatDays(balance.Quota)}*\n` +
    `Kullanılan İzin: *${formatDays(balance.Usedx)}*\n` +
    `Kalan İzin: *${formatDays(balance.Balnc)}*\n\n` +
    "_SAP izin kotası bilgileri._"
  );
}

module.exports = {
  textPayload,
  parseSelectionId,
  historyPayload,
  historyDetail,
  balancePayload,
  sapDate
};


// SAP OData tarihini okunabilir biçime dönüştür
function formatHistoryDate(value) {
  if (value == null || value === "") {
    return "-";
  }

  const raw = String(value).trim();

  const sapMatch = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(raw);

  if (sapMatch) {
    const date = new Date(Number(sapMatch[1]));

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
        .slice(0, 10)
        .split("-")
        .reverse()
        .join(".");
    }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);

  if (iso) {
    return `${iso[3]}.${iso[2]}.${iso[1]}`;
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);

  if (compact) {
    return `${compact[3]}.${compact[2]}.${compact[1]}`;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    return raw;
  }

  return "-";
}


// WhatsApp biçimlendirmesini bozan karakterleri temizle
function cleanHistoryText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t*_~`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// Doğrudan tablo benzeri izin geçmişi mesajları
function historyTablePayloads(to, records, ctx) {
  const { resultPayload } = require("./navigation-messages");

  if (!Array.isArray(records)) {
    throw new Error("Geçersiz izin geçmişi yanıtı.");
  }

  function formatDate(value) {
    if (value == null || value === "") {
      return "-";
    }

    const raw = String(value).trim();

    const sap = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(raw);

    if (sap) {
      const date = new Date(Number(sap[1]));

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString()
          .slice(0, 10)
          .split("-")
          .reverse()
          .join(".");
      }
    }

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);

    if (iso) {
      return `${iso[3]}.${iso[2]}.${iso[1]}`;
    }

    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);

    if (compact) {
      return `${compact[3]}.${compact[2]}.${compact[1]}`;
    }

    if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
      return raw;
    }

    return "-";
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/[\r\n\t*_~`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const heading = [
    "🗓️ *İzin Geçmişim*",
    "",
    `*Dönem:* ${formatDate(ctx.begda)} - ${formatDate(ctx.endda)}`,
    `*Toplam Kayıt:* ${records.length}`
  ].join("\n");

  if (!records.length) {
    return [
      resultPayload(
        to,
        heading + "\n\nİzin kaydı bulunamadı."
      )
    ];
  }

  const columns =
    "*İzin Türü | Başlangıç | Bitiş*\n" +
    "────────────────────";

  const base = heading + "\n\n" + columns + "\n";

  const pages = [];
  let current = base;

  for (const record of records) {
    const type = (
      clean(record.Atext) ||
      clean(record.Awart) ||
      "-"
    ).slice(0, 120);

    const row = [
      type,
      formatDate(record.Begda),
      formatDate(record.Endda)
    ].join(" | ");

    if (
      (current + row + "\n").length > 950 &&
      current !== base
    ) {
      pages.push(current.trimEnd());
      current = base;
    }

    current += row + "\n";
  }

  if (current !== base) {
    pages.push(current.trimEnd());
  }

  return pages.map((page, index) => {
    const body = pages.length > 1
      ? page + `\n\n_Bölüm ${index + 1}/${pages.length}_`
      : page;

    if (index === pages.length - 1) {
      return resultPayload(to, body);
    }

    return textPayload(to, body);
  });
}

module.exports.historyTablePayloads = historyTablePayloads;
