// Hesap silinince RevenueCat müşteri kaydını da sil (KVKK: silinen hesabın
// satın alma kimliği RevenueCat'te kalmasın). En iyi çaba: buradaki bir hata
// kullanıcının hesap silmesini ASLA bozmaz, yalnız loglanır.
// app_user_id = Supabase kullanıcı id'si (webhook da aynı varsayımla çalışıyor).
export async function revenueCatMusteriSil(userId, log, fetchFn = fetch) {
  const key = process.env.REVENUECAT_SECRET_KEY;
  if (!key) {
    log?.info?.({ userId }, "revenuecat müşteri silme atlandı: REVENUECAT_SECRET_KEY yok");
    return "atlandi";
  }
  try {
    const r = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000), // sunucu yanıtı RevenueCat yüzünden asılı kalmasın
    });
    // 404 = müşteri zaten yok (hiç satın alma yapmamış); amaç gerçekleşmiş sayılır.
    if (r.ok || r.status === 404) return "silindi";
    log?.error?.({ userId, status: r.status }, "revenuecat müşteri silinemedi");
    return "hata";
  } catch (e) {
    log?.error?.({ userId, err: String(e?.message || e) }, "revenuecat müşteri silme isteği başarısız");
    return "hata";
  }
}
