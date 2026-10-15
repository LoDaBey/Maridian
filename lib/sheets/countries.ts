import type { CountryRecord } from "@/lib/db-types";

export const COUNTRIES: readonly CountryRecord[] = [
  { code: "AF", name: "Afghanistan", nameAr: "أفغانستان" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria", nameAr: "الجزائر" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BH", name: "Bahrain", nameAr: "البحرين" },
  { code: "BD", name: "Bangladesh", nameAr: "بنغلاديش" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "BG", name: "Bulgaria" },
  { code: "CA", name: "Canada" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China", nameAr: "الصين" },
  { code: "CO", name: "Colombia" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus", nameAr: "قبرص" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti", nameAr: "جيبوتي" },
  { code: "EG", name: "Egypt", nameAr: "مصر" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "ET", name: "Ethiopia", nameAr: "إثيوبيا" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France", nameAr: "فرنسا" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany", nameAr: "ألمانيا" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece", nameAr: "اليونان" },
  { code: "HU", name: "Hungary" },
  { code: "IN", name: "India", nameAr: "الهند" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran", nameAr: "إيران" },
  { code: "IQ", name: "Iraq", nameAr: "العراق" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel", nameAr: "إسرائيل" },
  { code: "IT", name: "Italy", nameAr: "إيطاليا" },
  { code: "JP", name: "Japan", nameAr: "اليابان" },
  { code: "JO", name: "Jordan", nameAr: "الأردن" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KW", name: "Kuwait", nameAr: "الكويت" },
  { code: "LB", name: "Lebanon", nameAr: "لبنان" },
  { code: "LY", name: "Libya", nameAr: "ليبيا" },
  { code: "MY", name: "Malaysia" },
  { code: "MR", name: "Mauritania", nameAr: "موريتانيا" },
  { code: "MX", name: "Mexico" },
  { code: "MA", name: "Morocco", nameAr: "المغرب" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NG", name: "Nigeria" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman", nameAr: "عُمان" },
  { code: "PK", name: "Pakistan", nameAr: "باكستان" },
  { code: "PS", name: "Palestine", nameAr: "فلسطين" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar", nameAr: "قطر" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia", nameAr: "روسيا" },
  { code: "SA", name: "Saudi Arabia", nameAr: "السعودية" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SG", name: "Singapore" },
  { code: "SO", name: "Somalia", nameAr: "الصومال" },
  { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" },
  { code: "ES", name: "Spain", nameAr: "إسبانيا" },
  { code: "SD", name: "Sudan", nameAr: "السودان" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria", nameAr: "سوريا" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TN", name: "Tunisia", nameAr: "تونس" },
  { code: "TR", name: "Turkey", nameAr: "تركيا" },
  { code: "UA", name: "Ukraine", nameAr: "أوكرانيا" },
  { code: "AE", name: "United Arab Emirates", nameAr: "الإمارات" },
  { code: "GB", name: "United Kingdom", nameAr: "بريطانيا" },
  { code: "US", name: "United States", nameAr: "الولايات المتحدة" },
  { code: "YE", name: "Yemen", nameAr: "اليمن" },
];

const byCode = new Map(COUNTRIES.map((country) => [country.code, country]));

export function countryByCode(code: string): CountryRecord | undefined {
  return byCode.get(code.toUpperCase());
}

export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) {
    return "";
  }
  const base = 0x1f1e6;
  return String.fromCodePoint(base + upper.charCodeAt(0) - 65, base + upper.charCodeAt(1) - 65);
}

export function countryName(country: CountryRecord, arabic = false): string {
  return arabic && country.nameAr ? country.nameAr : country.name;
}

export function countryLabel(country: CountryRecord, arabic = false): string {
  return `${countryFlag(country.code)} ${countryName(country, arabic)}`;
}

export function findCountry(raw: string): CountryRecord | undefined {
  const token = raw.trim();
  if (!token) {
    return undefined;
  }
  const upper = token.toUpperCase();
  const exact = countryByCode(upper);
  if (exact) {
    return exact;
  }
  const needle = token.toLowerCase();
  return COUNTRIES.find(
    (country) =>
      country.name.toLowerCase() === needle ||
      country.nameAr === token ||
      country.name.toLowerCase().includes(needle) ||
      (country.nameAr?.includes(token) ?? false),
  );
}
