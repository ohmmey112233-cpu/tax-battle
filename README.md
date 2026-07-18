# Tax Battle

เกมตอบคำถามภาษีแบบสดสำหรับห้องเรียน ผู้เรียนสแกน QR Code ใส่ชื่อเล่น และตอบคำถามตามชุดที่ผู้สอนเลือก โดยจัดอันดับจากความถูกต้องและความเร็ว รองรับผู้เล่นสูงสุด 150 คนต่อห้อง

## ความสามารถ

- ผู้สอนสร้างห้องและแสดง QR Code
- ผู้เรียนเข้าร่วมด้วยชื่อเล่นโดยไม่ต้องสมัครสมาชิก
- คำถามภาษีเงินได้บุคคลธรรมดา 20 ข้อ
- สร้างคำถามเอง บันทึกใช้ซ้ำ และนำเข้า/ส่งออกคลังคำถามเป็น JSON
- โหมด Quiz Battle สำหรับตอบพร้อมกันทั้งห้อง
- โหมด Jump Battle แบบเกมปีนด่านแนวตั้งบนมือถือ พร้อมพลังงานและ Quiz เติมพลังแบบไม่จับเวลารายข้อ
- Jump Battle จัดอันดับจากความสูงสูงสุด และใช้คะแนน Quiz ตัดสินเมื่อเสมอ
- ให้คะแนนจากคำตอบที่ถูกและเวลาที่ใช้
- กระดานอันดับระหว่างเกมและผลสรุปท้ายเกม
- ผู้สอนควบคุมเริ่มเกม เฉลย ไปข้อถัดไป และเริ่มใหม่

## เทคโนโลยี

- Next.js/Vinext บน Cloudflare Workers
- Cloudflare D1 สำหรับห้อง ผู้เล่น คำตอบ และคะแนน
- Drizzle ORM

## ติดตั้ง

ต้องใช้ Node.js 22.13 ขึ้นไปและบัญชี Cloudflare

```bash
npm ci
npx wrangler login
npm run db:create
npm run db:migrate
npm run deploy
```

คำสั่ง `db:create` จะสร้างฐานข้อมูล `tax-battle-db` และเพิ่ม D1 binding ชื่อ `DB` ลงใน `wrangler.jsonc` โดยอัตโนมัติ

## เผยแพร่อัตโนมัติจาก GitHub

Repository มี GitHub Actions สำหรับสร้าง D1, ลง migration และเผยแพร่ Worker อัตโนมัติ ให้เพิ่ม repository secrets สองรายการ:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

API Token ต้องมีสิทธิ์ Account Settings Read, Workers Scripts Edit และ D1 Edit จากนั้นเปิดแท็บ Actions และรัน workflow `Deploy Tax Battle to Cloudflare` หรือ push ไปที่ branch `main`

## พัฒนาในเครื่อง

```bash
npm ci
npm run dev
```

## หมายเหตุด้านความเป็นส่วนตัว

ระบบเก็บเฉพาะชื่อเล่น คำตอบ คะแนน และเวลาตอบในห้องเกม ไม่ต้องใช้บัญชี ChatGPT และไม่ควรใช้ชื่อจริงหรือข้อมูลส่วนบุคคลเป็นชื่อเล่น
