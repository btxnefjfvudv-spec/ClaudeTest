import { startMockSite } from './site.js';

// เปิดเว็บจำลองไว้ซ้อมใช้งาน: npm run mock
const port = Number(process.env.MOCK_PORT) || 4000;
const site = await startMockSite({ port });
console.log(`เว็บจำลอง: ${site.baseUrl}`);
console.log(`หน้าควบคุมเว็บจำลอง: ${site.origin}/__test/`);
console.log('นำ URL เว็บจำลองไปใส่ในช่อง "URL เว็บไซต์" ของโปรแกรมเพื่อซ้อม (ปิดด้วย Ctrl+C)');
