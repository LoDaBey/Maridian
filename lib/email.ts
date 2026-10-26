/**
 * Transactional email through Resend (https://resend.com). Optional: without
 * RESEND_API_KEY and EMAIL_FROM nothing is sent and in-app notifications still work.
 */
import { env } from "@/lib/env";

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function appLink(path: string): string {
  return new URL(path, env.APP_URL).toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** A plain card with a heading, a few lines and one button. */
export function emailLayout(input: { heading: string; lines: string[]; button: { label: string; href: string }; note?: string }): string {
  const lines = input.lines.map((line) => `<p style="margin:0 0 12px;color:#323338;font-size:15px;line-height:1.5" dir="auto">${escapeHtml(line)}</p>`).join("");
  const note = input.note
    ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #0073ea;background:#f5f6f8;color:#323338;font-size:14px;white-space:pre-wrap" dir="auto">${escapeHtml(input.note)}</blockquote>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Figtree,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 20px;font-weight:700;color:#0073ea;font-size:16px">Meridian</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#323338" dir="auto">${escapeHtml(input.heading)}</h1>
${lines}${note}
<a href="${escapeHtml(input.button.href)}" style="display:inline-block;background:#0073ea;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;font-size:15px">${escapeHtml(input.button.label)}</a>
</td></tr></table></td></tr></table></body></html>`;
}

/** Sends one email; returns false (never throws) when email is off or the provider fails. */
export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!emailEnabled()) {
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("email send failed", response.status);
    }
    return response.ok;
  } catch (error) {
    console.error("email send failed", error instanceof Error ? error.name : "error");
    return false;
  }
}
