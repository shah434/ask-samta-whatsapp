// ============================================
// whatsapp.js — Meta WhatsApp API functions
// ============================================

export async function sendMessage(to, text, env) {
  await fetch(
    `https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`,
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
}

export async function sendReaction(to, messageId, env) {
  await fetch(
    `https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`,
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
          emoji: '🙏'
        }
      })
    }
  );
}

export async function sendImage(to, imageUrl, caption, env) {
  await fetch(
    `https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`,
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
}

export async function getImageAsBase64(imageId, mimeType, env) {
  const mediaRes = await fetch(
    `https://graph.facebook.com/v18.0/${imageId}`,
    { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } }
  );
  const mediaData = await mediaRes.j