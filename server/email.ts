import { publicBaseUrl } from "./config";

/**
 * Sends email through Resend (resend.com) using its HTTP API - no extra package.
 * Needs RESEND_API_KEY. EMAIL_FROM sets the sender, e.g. "Storyteller <hello@yourdomain.com>"
 * (until a domain is verified in Resend, its test sender only delivers to your own address).
 * If no key is set, emails are skipped quietly.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Storyteller <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.warn(`[Email] Not sent (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    console.log(`[Email] Sent "${subject}"`);
    return true;
  } catch (err: any) {
    console.warn("[Email] Failed:", err?.message);
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function layout(heading: string, body: string, button: { label: string; url: string }) {
  return `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#2b2118">
  <h1 style="font-size:26px;margin:0 0 12px">${heading}</h1>
  <p style="font-size:18px;line-height:1.5;margin:0 0 24px">${body}</p>
  <a href="${button.url}" style="display:inline-block;background:#c2570c;color:#fff;text-decoration:none;font-size:18px;padding:14px 24px;border-radius:10px">${button.label}</a>
  <p style="font-size:14px;color:#7a6a5c;margin-top:32px">Storyteller - every story matters.</p>
</div>`;
}

export function movieReadyEmail(name: string | null, storyTitle: string, storyId: number) {
  const url = `${publicBaseUrl()}/stories/${storyId}`;
  return {
    subject: `Your movie is ready: ${storyTitle} 🎬`,
    html: layout(
      `${name ? esc(name) + ", your" : "Your"} movie is ready! 🎬`,
      `We've brought <strong>${esc(storyTitle)}</strong> to life. Tap below to watch it - and share it with the family.`,
      { label: "Watch my movie", url }
    ),
  };
}

export function movieFailedEmail(name: string | null, storyTitle: string, storyId: number) {
  const url = `${publicBaseUrl()}/stories/${storyId}`;
  return {
    subject: `We couldn't finish your movie: ${storyTitle}`,
    html: layout(
      `Sorry${name ? ", " + esc(name) : ""} - something went wrong`,
      `We weren't able to finish the movie for <strong>${esc(storyTitle)}</strong>. Please open your story and tap <em>Story Movie</em> to try again.`,
      { label: "Open my story", url }
    ),
  };
}
