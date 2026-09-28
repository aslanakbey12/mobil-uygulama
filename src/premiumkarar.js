// REVENUECAT OLAYI → PREMIUM KARARI (saf; webhook ve test aynı yerden okusun).
//
// CANCELLATION = otomatik yenileme KAPATILDI (erişim dönem sonuna kadar sürer);
// BILLING_ISSUE = ödeme takıldı, ek süre boyunca erişim sürer. İkisi de eskiden
// premium'u ANINDA düşürüyordu: denemeyi başlatıp hemen iptal eden (yaygın) ve
// ödemesi takılan kullanıcı, parası ödenmiş dönemde sunucu özelliklerini
// kaybediyordu (denetim 28 Eyl). expiration_at_ms gelecekteyse o ana kadar açık;
// geçmişteyse (iadede RevenueCat bitişi iade anına çeker) kapalı.
const ACTIVE = ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE"];
const INACTIVE = ["EXPIRATION", "SUBSCRIPTION_PAUSED"];
const DONEM_SONUNA_KADAR = ["CANCELLATION", "BILLING_ISSUE"];

// null = bu olay premium durumunu değiştirmiyor.
export function premiumKarari(ev, now = Date.now()) {
  const bitis = ev?.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null;
  if (ACTIVE.includes(ev?.type)) return { premium: true, bitis };
  if (INACTIVE.includes(ev?.type)) return { premium: false, bitis: null };
  if (DONEM_SONUNA_KADAR.includes(ev?.type)) {
    return ev.expiration_at_ms && ev.expiration_at_ms > now ? { premium: true, bitis } : { premium: false, bitis: null };
  }
  return null;
}
