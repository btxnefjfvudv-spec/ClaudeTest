import http from 'node:http';

/**
 * เว็บจำลองสำหรับทดสอบ เลียนแบบโครงสร้าง HTML ของหน้า std_register_course จริง
 * (ตาราง ลำดับ / รหัสวิชา / ชื่อวิชา / หน่วยกิต / เลือก sec และข้อความ "ไม่ถึงเวลาเลือก")
 *
 * ส่วนที่ "สมมติขึ้น" เพราะยังไม่เคยเห็นของจริง:
 * - หน้าเข้าสู่ระบบ
 * - ตอนระบบเปิด ช่อง "เลือก sec" เป็นลิงก์ "sec 1" ที่ถาม confirm() ก่อน
 * - วิชาเต็มแสดงคำว่า "เต็ม"
 * - หลังลงทะเบียนสำเร็จ เว็บพาไปหน้าโปรไฟล์
 */
export const REAL_COURSES = [
  ['503', 'ง32210', 'เบเกอรี่'],
  ['505', 'ง32224', 'การปลูกไม้ดอก'],
  ['506', 'ง32263', 'การเงินและการลงทุน'],
  ['507', 'ง32270', 'บัญชีเบื้องต้น'],
  ['510', 'ง32291', 'การเขียนแบบเทคนิค'],
  ['512', 'ต32202', 'ภาษาเวียดนามเพื่อการสื่อสาร 2'],
  ['513', 'ศ32262', 'ทักษะดนตรีตะวันตก'],
  ['514', 'ศ32272', 'ทัศนศิลป์'],
  ['515', 'ศ32273', 'ดนตรีไทย'],
].map(([seq, code, name]) => ({ seq, code, name }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(base, inner, { loggedIn = true } = {}) {
  const menu = loggedIn
    ? `<a href="${base}index.php?sop=profile_student"><font color="white" size="5">::  หน้าแรก </font> </a><br><br>
       <a href="${base}index.php?sop=std_register_course"><font color="white" size="5"> :: ลงทะเบียนวิชา  </font> </a><br> <br>
       <a href="${base}index.php?sop=logout"><font color="white" size="5"> ::  ออกจากระบบ </font></a>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ระบบลงทะเบียน</title></head><body>
<table width="1000" border="0" cellpadding="0" cellspacing="0" class="smallx"><tbody>
<tr><td colspan="2" align="center" valign="top"><table id="Table_01" width="1000"><tbody><tr><td>E - Enrollment</td></tr></tbody></table></td></tr>
<tr>
  <td width="233" align="left" valign="top"><table width="233" class="smallx" id="Table_01"><tbody><tr><td class="spac_bar20">${menu}</td></tr></tbody></table></td>
  <td width="767" align="center" valign="top"><table id="Table_01" width="767"><tbody><tr><td align="left">${inner}</td></tr></tbody></table></td>
</tr></tbody></table></body></html>`;
}

function registerPage(base, st) {
  const rows = st.courses
    .map((c) => {
      let action = 'ไม่ถึงเวลาเลือก';
      if (st.open) {
        action = st.full.has(c.code)
          ? 'เต็ม'
          : `<a href="${base}index.php?sop=std_register_sec&id=${c.seq}" onclick="return confirm('ยืนยันการลงทะเบียนวิชา ${esc(c.name)} ?')">sec 1</a>`;
      }
      return `<tr>
					<td align="center">${c.seq}</td>
					<td align="center">${esc(c.code)}</td>
					<td align="left">${esc(c.name)}</td>
					<td align="center">1.0</td>
					<td align="center">
					${action}</td>
				  </tr>`;
    })
    .join('\n');
  return layout(
    base,
    `<table width="750" id="Table_01"><tbody><tr><td></td><td width="673" align="center" valign="top">
    <table width="100%" class="smallx"><tbody><tr><td>&nbsp;</td></tr><tr><td><strong>ข้อมูลรายวิชาสำหรับลงทะเบียนเรียน</strong></td></tr></tbody></table>
    <table width="100%" border="0" cellpadding="4" cellspacing="0" bgcolor="#6392fa" class="black_line"><tbody><tr>
		<td width="5%" align="center" bgcolor="#0651d1"><span class="style1">ลำดับ</span></td>
        <td width="11%" align="center" bgcolor="#0651d1"><span class="style1">รหัสวิชา</span></td>
        <td width="52%" align="left" bgcolor="#0651d1"><span class="style1">ชื่อวิชา</span></td>
        <td width="17%" align="center" bgcolor="#0651d1"><span class="style1">หน่วยกิต</span></td>
        <td width="15%" align="center" bgcolor="#0651d1"><span class="style1">เลือก sec </span></td>
      </tr>
      ${rows}
    </tbody></table></td><td></td></tr></tbody></table>`,
  );
}

function profilePage(base, st) {
  const enrolled = st.courses.filter((c) => st.enrolled.has(c.code));
  const rows = enrolled.length
    ? enrolled
        .map(
          (c) =>
            `<tr><td>${esc(c.code)}</td><td>1</td><td>${esc(c.name)}</td><td>1.0</td><td>-</td><td>-</td><td><a href="#">ยกเลิก</a></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="7" align="center">ไม่พบข้อมูลการลงทะเบียน</td></tr>';
  return layout(
    base,
    `<table><tbody><tr><td>รหัสนักเรียน :</td><td>00000</td></tr><tr><td>ชื่อ - สกุล :</td><td>นักเรียน ทดสอบ</td></tr></tbody></table>
    <strong>ข้อมูลรายวิชาที่ลงทะเบียน</strong>
    <table class="black_line"><tbody>
      <tr><td>รหัสวิชา</td><td>section</td><td>ชื่อวิชา</td><td>หน่วยกิต</td><td>วันเวลาเรียน</td><td>วันเวลาสอบ</td><td>ยกเลิก</td></tr>
      ${rows}
    </tbody></table>
    <strong>ข้อมูลชุมนุมที่ลงทะเบียน</strong>
    <table class="black_line"><tbody>
      <tr><td>รหัสวิชา</td><td>ชื่อวิชา</td><td>ชื่อกลุ่มย่อย</td><td>หน่วยกิต</td><td>วันเวลาเรียน</td><td>ยกเลิก</td></tr>
      <tr><td colspan="6" align="center">ไม่พบข้อมูลการลงทะเบียน</td></tr>
    </tbody></table>`,
  );
}

function loginPage(base) {
  return layout(
    base,
    `<form method="post" action="${base}index.php?sop=login">
      <p>รหัสนักเรียน <input name="username"></p>
      <p>รหัสผ่าน <input name="password" type="password"></p>
      <p><input type="submit" value="เข้าสู่ระบบ"></p>
    </form>`,
    { loggedIn: false },
  );
}

function controlPage(st) {
  const b = (k, label) => `<form method="post" action="/__test/set?${k}"><button>${label}</button></form>`;
  return `<!doctype html><meta charset="utf-8"><title>Mock control</title>
  <h1>ควบคุมเว็บจำลอง</h1>
  <p>เปิดระบบ: ${st.open} | วิชาเต็ม: ${[...st.full].join(', ') || '-'} | ไม่ตอบยืนยัน: ${st.noConfirm} | หน่วง: ${st.delayMs} ms | ลงแล้ว: ${[...st.enrolled].join(', ') || '-'} | จำนวนครั้งที่ส่ง: ${st.submits}</p>
  ${b('open=1', 'เปิดระบบ')}${b('open=0', 'ปิดระบบ')}${b('full=ง32210', 'ให้ ง32210 เต็ม')}${b('full=', 'ล้างวิชาเต็ม')}
  ${b('expire=1', 'ทำให้เซสชันหมดอายุ')}${b('noConfirm=1', 'ไม่ตอบผลหลังกด')}${b('noConfirm=0', 'ตอบผลตามปกติ')}${b('delay=3000', 'หน่วง 3 วินาที')}${b('delay=0', 'ไม่หน่วง')}${b('reset=1', 'ล้างการลงทะเบียน')}
  <p><a href="/__test/login">เข้าสู่ระบบ (จำลอง)</a></p>`;
}

export function createMockState() {
  return {
    open: false,
    full: new Set(),
    noConfirm: false,
    delayMs: 0,
    sessions: new Set(),
    enrolled: new Set(),
    submits: 0,
    courses: REAL_COURSES.map((c) => ({ ...c })),
  };
}

export async function startMockSite({ port = 0, host = '127.0.0.1' } = {}) {
  const st = createMockState();
  let sessionSeq = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const base = `/rw_enrollment/_site/`;
    const cookie = /MOCKSESS=(\w+)/.exec(req.headers.cookie || '')?.[1];
    const loggedIn = !!cookie && st.sessions.has(cookie);
    const html = (body, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(body);
    };
    const redirect = (to, headers = {}) => {
      res.writeHead(302, { Location: to, ...headers });
      res.end();
    };
    const newSession = () => {
      const id = `s${++sessionSeq}x${Date.now()}`;
      st.sessions.add(id);
      return `MOCKSESS=${id}; Path=/; HttpOnly`;
    };

    if (url.pathname === '/__test/' || url.pathname === '/__test') return html(controlPage(st));
    if (url.pathname === '/__test/login') {
      return redirect(`${base}index.php?sop=std_register_course`, { 'Set-Cookie': newSession() });
    }
    if (url.pathname === '/__test/set' && req.method === 'POST') {
      const p = url.searchParams;
      if (p.has('open')) st.open = p.get('open') === '1';
      if (p.has('full')) st.full = new Set(p.get('full') ? [p.get('full')] : []);
      if (p.has('expire')) st.sessions.clear();
      if (p.has('noConfirm')) st.noConfirm = p.get('noConfirm') === '1';
      if (p.has('delay')) st.delayMs = Number(p.get('delay')) || 0;
      if (p.has('reset')) {
        st.enrolled.clear();
        st.submits = 0;
      }
      return redirect('/__test/');
    }

    if (!url.pathname.startsWith(base)) return html('not found', 404);
    if (st.delayMs) await new Promise((r) => setTimeout(r, st.delayMs));

    const sop = url.searchParams.get('sop');
    if (sop === 'login' && req.method === 'POST') {
      return redirect(`${base}index.php?sop=profile_student`, { 'Set-Cookie': newSession() });
    }
    if (sop === 'logout') {
      if (cookie) st.sessions.delete(cookie);
      return redirect(`${base}index.php`);
    }
    if (!loggedIn) return html(loginPage(base));

    if (sop === 'std_register_course') return html(registerPage(base, st));
    if (sop === 'profile_student') return html(profilePage(base, st));
    if (sop === 'std_register_sec') {
      st.submits += 1;
      const course = st.courses.find((c) => c.seq === url.searchParams.get('id'));
      if (!course || !st.open) return redirect(`${base}index.php?sop=std_register_course`);
      if (st.noConfirm) return html(registerPage(base, st));
      if (st.full.has(course.code)) {
        return html(`<script>alert('ไม่สามารถลงทะเบียนได้ วิชาเต็ม');location='${base}index.php?sop=std_register_course'</script>`);
      }
      st.enrolled.add(course.code);
      return redirect(`${base}index.php?sop=profile_student`);
    }
    return html(profilePage(base, st));
  });

  await new Promise((r) => server.listen(port, host, r));
  const addr = server.address();
  return {
    state: st,
    baseUrl: `http://${host}:${addr.port}/rw_enrollment/_site/`,
    origin: `http://${host}:${addr.port}`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}
