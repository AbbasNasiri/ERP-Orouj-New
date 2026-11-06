import packageInfo from '../package.json';
import './about-desk.css';

export default function AboutDesk() {
  return <section className="about-desk" dir="rtl" aria-label="درباره برنامه">
    <h2>درباره برنامه</h2>
    <p className="about-desk-version">نسخه <bdi>{packageInfo.version}</bdi></p>
    <p>این نرم‌افزار به همت <strong>عباس نصیری</strong> و با بهره‌گیری از ابزارهای هوش مصنوعی <bdi>apGPt</bdi>، <bdi>Claude</bdi> و <bdi>Qoder</bdi> بررسی و پیاده‌سازی شده است.</p>
    <p>از همکاران گرامی دعوت می‌شود نتایج بررسی، تجربه‌های کاربردی و پیشنهادهای خود را از طریق نشانی <a href="mailto:asn.nasiri@hotmail.com"><bdi>asn.nasiri@hotmail.com</bdi></a> در میان بگذارند.</p>
    <p>همراهی شما در بهبود مستمر این نرم‌افزار و گسترش دانش و تجربهٔ مشترک ارزشمند است.</p>
  </section>;
}
