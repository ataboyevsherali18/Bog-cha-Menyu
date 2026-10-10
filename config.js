// ===== SOZLAMALAR (config.js) =====
// Narx, bonus va oylik bepul yuklash soni endi SERVERDA (Netlify -> Environment variables) boshqariladi,
// shuning uchun bu yerda faqat ko'rinadigan ma'lumotlar qoladi.
window.CFG = {
  brand: "Bog'cha menyu",              // sayt nomi
  freeDay: 1,                          // bepul namuna: to'lovsiz Jadvalda faqat shu kun ko'rinadi
  api: "/api",                         // server manzili (o'zgartirmang)

  price: 50000,                        // (zaxira) server javob bermasa ko'rinadigan narx; asl narx: Netlify PRICE
  bonusEvery: 10,                      // (zaxira) har nechta pullik yuklashdan keyin bonus
  bonusFree: 2,                        // (zaxira) nechta bonus
  freeMonthly: 1,                      // (zaxira) oyiga bepul yuklash

  card:  "6262 5700 5729 8061",        // karta raqami
  owner: "Sherali Ataboyev",           // karta egasi
  payme: "",                           // Payme havolasi (bo'sh bo'lsa tugma chiqmaydi)
  click: "https://my.click.uz/clickp2p/8BC4C81B10F27C43485ACC924AE1072145E2E31E6D91B0F0D53DF085665DEA02",
  wa:    "998905754019",               // WhatsApp raqamingiz (+ belgisiz)
  tg:    "@sh_ataboyev"                // Telegram username
};
