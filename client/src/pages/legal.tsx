import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Privacy policy and terms, in plain English. Business details come from Railway
 * variables (BUSINESS_NAME, ABN, CONTACT_EMAIL) via /api/public-info.
 * DRAFT - have these checked before launch; not legal advice.
 */
const UPDATED = "11 November 2026";

type Info = { businessName: string; abn: string; contactEmail: string };
function useInfo(): Info {
  const { data } = useQuery<Info>({
    queryKey: ["/api/public-info"],
    queryFn: async () => (await fetch("/api/public-info")).json(),
    staleTime: Infinity,
  });
  return data || { businessName: "Storyteller", abn: "", contactEmail: "" };
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-5 py-10">
      <article className="max-w-2xl mx-auto space-y-5 text-base leading-relaxed [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-bold [&_h2]:pt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
        <a href="/" className="text-primary text-sm hover:underline">← Back to Storyteller</a>
        <h1 className="font-serif text-3xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
        {children}
      </article>
    </div>
  );
}

function Contact({ info }: { info: Info }) {
  return info.contactEmail ? (
    <a href={`mailto:${info.contactEmail}`} className="text-primary underline">{info.contactEmail}</a>
  ) : (
    <span>the contact email on our website</span>
  );
}

export function PrivacyPage() {
  const info = useInfo();
  const who = `${info.businessName}${info.abn ? ` (ABN ${info.abn})` : ""}`;
  return (
    <Page title="Privacy policy">
      <p>
        Storyteller is run by {who}, in Australia. Your stories, photos and voice are precious, and this page explains,
        in plain English, what we collect, why, and who can see it. We follow the Australian Privacy Principles.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email address and a scrambled (hashed) version of your password.</li>
        <li><strong>Your stories:</strong> what you write or record, and the answers you give the story helper.</li>
        <li><strong>Photos</strong> you upload so you can appear in your pictures and movies.</li>
        <li><strong>Voice recordings</strong> you make so your movie can be narrated in your voice.</li>
        <li><strong>What we make for you:</strong> storybook pictures, movies, narration and printable books.</li>
        <li><strong>Payments:</strong> handled by Stripe. We never see or store your card number; we only know what you bought and when.</li>
      </ul>

      <h2>Why we use it</h2>
      <p>Only to make and keep your storybooks and movies, run your account, take payments, email you (for example "your movie is ready" or a password reset) and keep the service safe. We don't sell your information, and we don't use your stories, photos or voice for advertising.</p>

      <h2>Who else handles it</h2>
      <p>To make your pictures, movies and narration, we send the parts that are needed to these trusted services. Some of them are overseas (mainly the United States):</p>
      <ul>
        <li><strong>OpenAI</strong>: writing help, voice-to-text and pictures</li>
        <li><strong>Replicate</strong>: turning pictures into movie clips, and narration in your voice</li>
        <li><strong>Railway</strong>: hosts the app and stores your files</li>
        <li><strong>Stripe</strong>: payments</li>
        <li><strong>Resend</strong>: sends our emails</li>
      </ul>
      <p>They may only use your information to provide their service to us.</p>

      <h2>Who can see your stories</h2>
      <p>Your stories are private to your account. Nobody else can see them unless you make a share link. Anyone with that link can view that one storybook, so only send it to people you trust. You can turn a share off at any time. Your voice recording is never shared and only plays for you.</p>

      <h2>Photos and voices of other people</h2>
      <p>Only upload photos or record voices of yourself, or of someone who has said yes. If a story is about someone under 18, a parent or guardian must be the one using the app.</p>

      <h2>How long we keep it</h2>
      <p>We keep your stories and files while you have an account. You can delete a story, its pictures or movies, and your voice recording yourself in the app at any time. To delete your whole account and everything in it, email us and we'll do it within 30 days.</p>

      <h2>Security</h2>
      <p>Passwords are scrambled, connections are encrypted, and each person can only reach their own stories. No system is perfect, but if something ever went wrong with your information, we'd tell you.</p>

      <h2>Your rights</h2>
      <p>You can ask to see, correct or delete your information, or complain about how we've handled it, by emailing <Contact info={info} />. If you're not happy with our answer, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).</p>

      <h2>Changes</h2>
      <p>If we change this policy, we'll update the date at the top and let you know by email if the change is important.</p>
    </Page>
  );
}

export function TermsPage() {
  const info = useInfo();
  const who = `${info.businessName}${info.abn ? ` (ABN ${info.abn})` : ""}`;
  return (
    <Page title="Terms of use">
      <p>These terms are the agreement between you and {who} for using Storyteller. By making an account you agree to them.</p>

      <h2>Your stories stay yours</h2>
      <p>You own your stories, photos and recordings. You let us use them only to make, store and show your storybooks and movies for you (and to anyone you share them with). The pictures and movies we make for your story are yours to keep, download and share with family and friends.</p>

      <h2>What you agree to</h2>
      <ul>
        <li>Only upload photos and voices of yourself, or of people who have agreed.</li>
        <li>Don't use Storyteller to copy someone's voice or face without their permission, or to pretend to be someone else.</li>
        <li>No sexual content, no hateful content, and nothing that harms or exploits anyone. Children are always shown modestly dressed.</li>
        <li>If you're under 18, a parent or guardian needs to set up and manage the account.</li>
      </ul>
      <p>We may remove content or close accounts that break these rules.</p>

      <h2>About the AI</h2>
      <p>Pictures, movies and narration are made by AI. They're a creative re-telling of your memory, not a record of what really happened, and the AI sometimes gets details wrong. That's why you get a few goes. The AI services may also refuse some content.</p>

      <h2>Prices and payment</h2>
      <ul>
        <li>Your first storybook is free.</li>
        <li>After that you pay once per story for the Storybook, Movie or Everything. Prices are shown in Australian dollars before you pay.</li>
        <li>Each purchase includes a set number of goes for that story (shown when you buy). If a picture set or movie fails to be made, it doesn't use up a go.</li>
        <li>There's no subscription and nothing renews.</li>
      </ul>

      <h2>Refunds</h2>
      <p>Our services come with guarantees that can't be excluded under the Australian Consumer Law. If something you paid for doesn't work and we can't fix it, contact us and we'll make it right, including a refund where you're entitled to one. Because each movie and storybook costs us money to make, we don't refund simply for a change of mind once it's been made.</p>

      <h2>Keeping things running</h2>
      <p>We work hard to keep Storyteller running and your files safe, but we can't promise it will never be unavailable. We recommend downloading the movies and books you love.</p>

      <h2>Limits</h2>
      <p>To the extent the law allows, we're not responsible for indirect losses, and our total responsibility is limited to what you paid us in the last 12 months. Nothing here takes away your rights under the Australian Consumer Law.</p>

      <h2>Contact</h2>
      <p>Questions, problems or refund requests: <Contact info={info} />. These terms are governed by the laws of Queensland, Australia.</p>
    </Page>
  );
}
