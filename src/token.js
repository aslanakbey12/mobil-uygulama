// LiveKit erişim token'ı üretir. İstemci bu token ile sesli odaya (WebRTC) katılır.
import { AccessToken } from "livekit-server-sdk";

export function livekitConfigured() {
  return Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL);
}

export async function mintToken({ identity, name, roomName }) {
  if (!livekitConfigured()) {
    throw new Error("LiveKit yapılandırılmamış (.env içindeki LIVEKIT_* değerlerini doldurun)");
  }
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: name || identity,
    ttl: "1h"
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,      // sesli konuşabilir
    canSubscribe: true,    // başkalarını duyabilir
    canPublishData: true   // metin/sinyal (ör. "el kaldır")
  });
  const jwt = await at.toJwt();
  return { token: jwt, url: process.env.LIVEKIT_URL, roomName, identity };
}
