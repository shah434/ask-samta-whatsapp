// ============================================
// whatsapp.js — Meta WhatsApp API functions
// ============================================

const WA_BASE = `https://graph.facebook.com/v22.0`;

export async function sendMessage(to, text, env) {
  if (!text || !text.trim()) {
    console.log(`[whatsapp] refused_empty_send to=${to}`);
    return;
  }
  const res = await fetch(
    `${WA_BASE}/${env.PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    console.log(`[whatsapp] sendMessage_error status=${res.status} to=${to} body=${errBody.slice(0, 200)}`);
  }
}

export async function sendReaction(to, messageId, env) {
  const res = await fetch(
    `${WA_BASE}/${env.PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji: '🙏🏾'
        }
      })
    }
  );
  if (!res.ok) {
    console.log(`[whatsapp] sendReaction_error status=${res.status} to=${to}`);
  }
}

export async function sendImage(to, imageUrl, caption, env) {
  const res = await fetch(
    `${WA_BASE}/${env.PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: {
          link: imageUrl,
          caption
        }
      })
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    console.log(`[whatsapp] sendImage_error status=${res.status} to=${to} body=${errBody.slice(0, 200)}`);
  }
}

export async function getImageAsBase64(imageId, mimeType, env) {
  const mediaRes = await fetch(
    `${WA_BASE}/${imageId}`,
    { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } }
  );
  if (!mediaRes.ok) {
    throw new Error(`WhatsApp media metadata fetch failed: ${mediaRes.status}`);
  }
  const mediaData = await mediaRes.json();

  const imgRes = await fetch(mediaData.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
  });

  const imgBuffer = await imgRes.arrayBuffer();
  const bytes = new Uint8Array(imgBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return {
    base64: btoa(binary),
    mimeType: mimeType || 'image/jpeg'
  };
}
