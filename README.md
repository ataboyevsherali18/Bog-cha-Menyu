# Bog'cha menyu — o'rnatish (10 daqiqa)

## 1. Netlify'ga yuklash
Funksiyalar ishlashi uchun oddiy "drag & drop" emas, quyidagilardan biri kerak:
- **GitHub orqali (tavsiya):** shu papkani GitHub'ga yuklang → Netlify → Add new site → Import from Git.
- **Yoki kompyuterdan:** papkada `npx netlify-cli deploy --prod` ni ishga tushiring.

## 2. Admin paroli
Netlify → Site configuration → Environment variables → **ADMIN_PASSWORD** qo'shing (o'zingiz o'ylagan murakkab parol). Keyin Deploy qayta bajaring.

Ixtiyoriy o'zgaruvchilar (yozmasangiz, qavs ichidagi qiymat ishlaydi):
PRICE (50000), BONUS_EVERY (10), BONUS_FREE (2), BONUS_DAYS (60), FREE_MONTHLY (1), FILES_MAX (30).

## 3. Ishlatish
- Mijoz: `sayt.uz` — ro'yxatdan o'tadi (telefon + PIN).
- Siz: `sayt.uz/admin.html` — parol bilan kirasiz, "Yangi kod" → WhatsApp/Telegram tugmasi bilan mijozga yuborasiz.
- Eski admin.html va eski kodlar endi ishlamaydi (yangi tizim serverda).
