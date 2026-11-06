const MAX_STORED = 100000;
export const avatarKey = userId => `printshop-avatar-v1:${encodeURIComponent(String(userId || ''))}`;
export function validAvatar(value) { return typeof value === 'string' && value.length <= MAX_STORED && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value); }
export function loadAvatar(userId) {
  try { const value = localStorage.getItem(avatarKey(userId)); return validAvatar(value) ? value : ''; } catch (_) { return ''; }
}
export async function saveAvatar(userId, file) {
  if (!userId) throw new Error('برای انتخاب تصویر وارد حساب شوید.');
  if (!file) { localStorage.removeItem(avatarKey(userId)); return ''; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('تصویر JPG، PNG یا WebP با حجم کمتر از ۲ مگابایت انتخاب کنید.');
  const image = new Image(), url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('فایل تصویر قابل خواندن نیست.')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('ابعاد تصویر بیش از حد بزرگ است.');
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('آماده‌سازی تصویر ممکن نیست.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#FBF6EC'; context.fillRect(0, 0, 128, 128);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    const value = canvas.toDataURL('image/jpeg', 0.8);
    if (!validAvatar(value)) throw new Error('تصویر آماده‌شده معتبر نیست.');
    try { localStorage.setItem(avatarKey(userId), value); } catch (_) { throw new Error('فضای ذخیره تصویر کافی نیست.'); }
    return value;
  } finally { URL.revokeObjectURL(url); }
}
