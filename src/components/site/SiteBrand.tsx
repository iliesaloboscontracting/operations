// The Lobos wolf mark + name at the top of the phone pages (supervisor links
// and crew sign-in) - 22 Oct 2026. The image lives under /site/ so it loads
// on the photos address too. Cyan is the Lobos brand blue (#08A7C9).
export default function SiteBrand() {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/site/icons/site-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" />
      <span className="leading-none">
        <span className="block text-[15px] font-extrabold tracking-[0.14em] text-white">LOBOS</span>
        <span className="mt-1 block text-[9px] font-semibold tracking-[0.28em] text-[#08A7C9]">CONTRACTING</span>
      </span>
    </span>
  );
}
