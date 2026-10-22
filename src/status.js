export const Status = Object.freeze({
  READY: 'READY',
  WAITING: 'WAITING',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  COURSE_AVAILABLE: 'COURSE_AVAILABLE',
  COURSE_FULL: 'COURSE_FULL',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

export const STATUS_LABEL_TH = Object.freeze({
  READY: 'พร้อมดำเนินการ',
  WAITING: 'ยังไม่ถึงเวลาเปิดลงทะเบียน',
  LOGIN_REQUIRED: 'ต้องเข้าสู่ระบบ',
  COURSE_AVAILABLE: 'พบวิชาที่ต้องการและยังเปิดรับ',
  COURSE_FULL: 'วิชาเต็ม',
  CONFIRMATION_REQUIRED: 'รอผู้ใช้ยืนยัน',
  SUCCESS: 'เว็บไซต์ยืนยันว่าลงทะเบียนสำเร็จ',
  FAILED: 'ดำเนินการไม่สำเร็จ',
  UNKNOWN: 'ยังยืนยันสถานะไม่ได้',
});

// สถานะของแต่ละวิชาที่อ่านได้จากตารางบนเว็บ
export const CourseState = Object.freeze({
  NOT_OPEN: 'NOT_OPEN',
  OPEN: 'OPEN',
  FULL: 'FULL',
  UNKNOWN: 'UNKNOWN',
});

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
