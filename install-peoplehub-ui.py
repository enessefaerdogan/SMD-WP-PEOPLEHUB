#!/usr/bin/env python3
"""Minimal, idempotent WhatsApp Flow + typing UI patch. Does not change OData client."""
from pathlib import Path
from datetime import datetime
import json, re, shutil

root = Path.cwd()
server, menus = root / 'server.js', root / 'menus.js'
if not server.is_file() or not menus.is_file():
    raise SystemExit('HATA: whatsapp-support-api proje klasöründe çalıştırın (server.js ve menus.js gerekli).')
s = server.read_text()
if 'async function sendWhatsAppPayload(payload) {' not in s:
    raise SystemExit('HATA: sendWhatsAppPayload fonksiyonu bulunamadı. Hiçbir dosya değiştirilmedi.')
if '    if (message.type === "interactive") {' not in s:
    raise SystemExit('HATA: interactive handler bulunamadı. Hiçbir dosya değiştirilmedi.')
if 'handleMessage().catch(' not in s:
    raise SystemExit('HATA: handleMessage().catch bulunamadı. Hiçbir dosya değiştirilmedi.')

# A standalone, static Flow. Navigation is native, OData and HR logic remain unchanged.
def nav_item(item_id, title, next_screen, desc=None, payload=None):
    item = {'id': item_id, 'main-content': {'title': title}}
    if desc:
        item['main-content']['metadata'] = desc
    action = {'name': 'navigate', 'next': {'type': 'screen', 'name': next_screen}}
    if payload is not None:
        action['payload'] = payload
    item['on-click-action'] = action
    return item

def nav_screen(screen_id, title, name, items):
    return {'id': screen_id, 'title': title,
            'layout': {'type': 'SingleColumnLayout', 'children': [
                {'type': 'NavigationList', 'name': name, 'list-items': items}
            ]}}

def placeholder(screen_id, title):
    return {'id': screen_id, 'title': title, 'terminal': True,
            'layout': {'type': 'SingleColumnLayout', 'children': [
                {'type': 'TextHeading', 'text': title},
                {'type': 'TextBody', 'text': 'Bu işlemin SAP OData ekranını sonraki aşamada bağlayacağız.'},
                {'type': 'Footer', 'label': 'Kapat',
                 'on-click-action': {'name': 'complete', 'payload': {'action': 'CLOSE'}}}
            ]}}

main = [nav_item('main_leave', '🏖️ İzin Süreçleri', 'LEAVE', 'İzin talepleri ve kayıtlar')]
for i, title in enumerate([
    '💰 Bordro ve Ücret', '🕒 Mesai ve Devam', '👤 Özlük İşlemleri',
    '✅ Onay İşlemleri', '📋 Diğer HR İşlemleri'
]):
    main.append(nav_item(f'main_{i}', title, 'OTHER_INFO', payload={'category': title}))

leave_titles = [
    ('LEAVE_REQUEST', '📝 İzin Talep Et'),
    ('LEAVE_BALANCE', '📊 İzin Bakiyem'),
    ('LEAVE_HISTORY', '🗓️ İzin Geçmişim'),
    ('LEAVE_PENDING', '⏳ Bekleyen İzinler'),
    ('LEAVE_CANCEL', '❌ İzin İptali')
]
leave = [nav_item(f'leave_{i}', title, screen) for i, (screen, title) in enumerate(leave_titles)]

request = {'id': 'LEAVE_REQUEST', 'title': 'İzin Talep Et', 'terminal': True,
    'layout': {'type': 'SingleColumnLayout', 'children': [
        {'type': 'TextHeading', 'text': 'Yeni İzin Talebi'},
        {'type': 'Dropdown', 'name': 'awart', 'label': 'İzin Türü', 'required': True,
         'data-source': [{'id': '0100', 'title': 'Yıllık İzin'}]},
        {'type': 'CalendarPicker', 'name': 'period', 'mode': 'range',
         'title': 'İzin tarihleri',
         'label': {'start-date': 'Başlangıç', 'end-date': 'Bitiş'},
         'required': {'start-date': True, 'end-date': True}},
        {'type': 'TextCaption', 'text': 'Önizleme: SAP sisteminde henüz izin kaydı oluşturulmaz.'},
        {'type': 'Footer', 'label': 'Talebi Kontrol Et', 'on-click-action': {
            'name': 'complete', 'payload': {
                'action': 'LEAVE_PREVIEW', 'awart': '${form.awart}',
                'period': '${form.period}'
            }
        }}
    ]}}
other = {'id': 'OTHER_INFO', 'title': 'İK İşlemleri', 'terminal': True,
    'data': {'category': {'type': 'string', '__example__': 'Bordro ve Ücret'}},
    'layout': {'type': 'SingleColumnLayout', 'children': [
        {'type': 'TextHeading', 'text': '${data.category}'},
        {'type': 'TextBody', 'text': 'Bu modülü sonraki aşamada bağlayacağız.'},
        {'type': 'Footer', 'label': 'Kapat',
         'on-click-action': {'name': 'complete', 'payload': {'action': 'CLOSE'}}}
    ]}}
flow = {'version': '7.3', 'screens': [
    nav_screen('HOME', 'SMOD PeopleHub', 'hr_main_menu', main),
    nav_screen('LEAVE', 'İzin Süreçleri', 'leave_menu', leave),
    request,
    *[placeholder(screen, title) for screen, title in leave_titles[1:]],
    other
]}

helper = r'''"use strict";
const { randomUUID } = require("node:crypto");
function createPeopleHubFlow(to, screen = "HOME") {
  const flowId = (process.env.WHATSAPP_FLOW_ID || "").trim();
  if (!/^\d+$/.test(flowId)) throw new Error("WHATSAPP_FLOW_ID ayarlanmamış.");
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to,
    type: "interactive", interactive: {
      type: "flow",
      header: { type: "text", text: "SMOD PeopleHub" },
      body: { text: "İnsan kaynakları işlemlerinize WhatsApp içinden erişin." },
      action: { name: "flow", parameters: {
        flow_message_version: "3", flow_token: randomUUID(), flow_id: flowId,
        flow_cta: "PeopleHub'ı Aç", flow_action: "navigate",
        flow_action_payload: { screen }
      } }
    }
  };
}
async function sendTypingIndicator(messageId) {
  if (!messageId) return;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return;
  const response = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read",
      message_id: messageId, typing_indicator: { type: "text" } }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) console.error("WHATSAPP_TYPING_FAILED", response.status, (await response.text()).slice(0, 500));
}
module.exports = { createPeopleHubFlow, sendTypingIndicator };
'''

if 'PEOPLEHUB_FLOW_UI_V1' not in s:
    # Inject require after the first regular require (leave dotenv initialization untouched).
    match = re.search(r'^(?:const|let|var)\s+[^\n]+?require\([^\n]+\);\s*$', s, flags=re.MULTILINE)
    if not match:
        raise SystemExit('HATA: require satırı bulunamadı. Hiçbir dosya değiştirilmedi.')
    s = s[:match.end()] + '\nconst { createPeopleHubFlow, sendTypingIndicator } = require("./peoplehub-wa-flow");' + s[match.end():]
    marker = 'async function sendWhatsAppPayload(payload) {'
    intercept = '''async function sendWhatsAppPayload(payload) {
  // PEOPLEHUB_FLOW_UI_V1 - only presentation changes, original SAP calls stay.
  if (process.env.WHATSAPP_FLOW_ID && payload?.type === "interactive" && payload.interactive?.type === "list") {
    const rows = (payload.interactive?.action?.sections || []).flatMap(section => section.rows || []);
    if (rows.some(row => row.id === "MENU_LEAVE")) {
      payload = createPeopleHubFlow(payload.to, "HOME");
    } else if (rows.some(row => row.id === "LEAVE_REQUEST")) {
      payload = createPeopleHubFlow(payload.to, "LEAVE");
    }
  }
'''
    s = s.replace(marker, intercept, 1)
    s = s.replace('handleMessage().catch(',
                  '''if (message?.id && (message.type === "text" || message.type === "interactive")) {
    sendTypingIndicator(message.id).catch(error => console.error("WHATSAPP_TYPING_ERROR", error.message));
  }
  handleMessage().catch(''', 1)
    # Keep the existing identity check, but preview Flow data without posting to SAP.
    target = '    if (message.type === "interactive") {'
    completion = '''    if (message.type === "interactive") {
      if (message.interactive?.type === "nfm_reply") {
        let flowData;
        try {
          flowData = JSON.parse(message.interactive.nfm_reply?.response_json || "{}");
        } catch (error) {
          console.error("INVALID_FLOW_RESPONSE", error.message);
          return;
        }
        if (flowData.action === "LEAVE_PREVIEW") {
          const period = flowData.period || {};
          const begda = period["start-date"];
          const endda = period["end-date"];
          if (flowData.awart !== "0100" ||
              !/^\\d{4}-\\d{2}-\\d{2}$/.test(begda || "") ||
              !/^\\d{4}-\\d{2}-\\d{2}$/.test(endda || "") || begda > endda) {
            await sendWhatsAppPayload(textPayload(message.from, "İzin tarihleri geçersiz. Formu yeniden açın."));
            return;
          }
          // Uses the existing SAP IdentSet client; no leave-write endpoint yet.
          const person = await getIdentity(message.from);
          if (!person) {
            await sendWhatsAppPayload(textPayload(message.from, "SAP personel kaydınız bulunamadı."));
            return;
          }
          const fmt = iso => iso.split("-").reverse().join(".");
          await sendWhatsAppPayload(textPayload(message.from,
            `*İzin talebi önizlemesi*\\n\\nPersonel: ${person.fullName || person.firstName}\\nİzin türü: Yıllık İzin\\nBaşlangıç: ${fmt(begda)}\\nBitiş: ${fmt(endda)}\\n\\n*Bilgi:* SAP sisteminde henüz izin kaydı oluşturulmadı.`));
        }
        return;
      }
'''
    s = s.replace(target, completion, 1)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copy2(server, server.with_name(f'server.js.bak-{stamp}'))
    server.write_text(s)
    print('SERVER_PATCHED')
else:
    print('SERVER_PATCH_ALREADY_PRESENT')

(root / 'peoplehub-wa-flow.js').write_text(helper)
(root / 'peoplehub-flow.json').write_text(json.dumps(flow, ensure_ascii=False, indent=2) + '\n')
print('PEOPLEHUB_UI_FILES_READY')
