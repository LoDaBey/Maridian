import { APP_NAME } from "@/lib/brand";

export function AppLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const mark = size === "lg" ? "size-10" : "size-7";
  const word = size === "lg" ? "text-xl" : "text-[15px]";

  return (
    <span className="inline-flex items-center gap-2 text-text">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={`${mark} shrink-0`}>
        <rect width="32" height="32" rx="8" fill="#101828" />
        <circle cx="16" cy="16" r="8" stroke="#F8FAFC" strokeWidth="1.8" />
        <ellipse cx="16" cy="16" rx="3.3" ry="8" stroke="#6AADFF" strokeWidth="1.8" />
        <path d="M8 16h16" stroke="#F8FAFC" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className={`${word} font-semibold tracking-[-0.03em]`}>{APP_NAME}</span>
    </span>
  );
}
