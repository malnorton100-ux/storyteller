/**
 * Save or share pictures. On iPhone/Android this opens the share sheet, where
 * "Save Image(s)" puts them in Photos and Messages/Facebook etc. are one tap away.
 * Elsewhere it downloads the files.
 */
export async function shareImages(urls: string[], baseName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const safe = baseName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "story";
  const files: File[] = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i], { credentials: "include" });
    const blob = await res.blob();
    const ext = blob.type.includes("jpeg") ? "jpg" : "png";
    files.push(new File([blob], `${safe}-${String(i + 1).padStart(2, "0")}.${ext}`, { type: blob.type || "image/png" }));
  }
  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files })) {
    try {
      await nav.share({ files });
      return "shared";
    } catch (err: any) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 250));
  }
  return "downloaded";
}
