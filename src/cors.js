// CORS ORIGIN EŞLEŞTİRME.
//
// Ayrı dosyada, çünkü bu güvenlik sınırında duran bir karar ve test edilebilir
// olması gerekiyor — server.js'i import etmek sunucuyu ayağa kaldırırdı.
//
// JOKER ALT ALAN: "https://*.netlify.app". Her Netlify dağıtımı yeni bir alan
// adı alıyor ve izin listesi elle güncellenmediğinde web sürümü sessizce
// kırılıyor. Tarayıcı isteği tamamen iptal ettiği için istemciye bu "sunucuya
// ulaşılamıyor" gibi görünüyor, yani teşhisi en zor arıza biçimi.
//
// Joker YALNIZCA alt alan bölümünde çalışıyor: kök alanın kendisini, kökü
// kendi adının içine gömen bir adresi ya da şeması değiştirilmiş bir adresi
// eşleştirmez. Gevşek bir joker, saldırganın kendi sayfasından bu API'ye
// istek atabilmesi demek olurdu.
export function originIzinli(liste, o) {
  if (!o) return false;
  for (const kural of liste) {
    if (kural === o) return true;
    const y = kural.indexOf("://*.");
    if (y < 0) continue;
    const sema = kural.slice(0, y + 3);   // "https://"
    const kok = kural.slice(y + 4);       // ".netlify.app"
    if (!o.startsWith(sema) || !o.endsWith(kok)) continue;
    const alt = o.slice(sema.length, o.length - kok.length);
    // alt boşsa kökün kendisi ("https://netlify.app"); "/" içeriyorsa origin
    // değil bir yol ("https://kotu.com/x.netlify.app").
    if (alt.length > 0 && !alt.includes("/")) return true;
  }
  return false;
}
