/* CivicTrace illustrations — hand-authored SVG, no external assets.
 *
 * Editorial rule for this file: characters may have faces, objects may not.
 * The sleuth is the narrator and is allowed to be likeable. Everything that
 * stands in for a real party to a real record — a donor, an industry, a
 * politician — is drawn as a neutral object or a neutral building. No money
 * bags, no cigars, no top hats, no smirking businessmen. The art must never
 * reach a verdict the data has not reached.
 */
import React from 'react'

type P = { size?: number }

const NAVY = '#12376b'
const BLUE = '#2f7bd6'
const SKYB = '#5b9ae6'
const PALE = '#eaf2fb'
const EDGE = '#c7d6e8'
const GOLD = '#ffd25e'
const GOLDD = '#e0a800'
const GREEN = '#3ea87a'
const RED = '#d9534f'
const SLATE = '#3b4a5c'
const STONE = '#8fa2b8'

/* A little painted scene: soft sky panel, horizon band, then the subject.
   Gives every illustration the same stage so a row of them reads as a set. */
function Scene({ size = 96, sky = PALE, ground = '#dbe7f4', children }:
  P & { sky?: string; ground?: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden role="presentation">
      <rect x="0" y="0" width="96" height="96" rx="12" fill={sky} />
      <path d="M0 64h96v20a12 12 0 0 1-12 12H12A12 12 0 0 1 0 84z" fill={ground} />
      {children}
      <rect x="0.75" y="0.75" width="94.5" height="94.5" rx="11.25"
        fill="none" stroke={EDGE} strokeWidth="1.5" />
    </svg>
  )
}

/* ---------------------------------------------------------------- wordmark */

export function Logo({ size = 34 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden>
      {/* a capitol dome read through a magnifier — the whole product in one mark */}
      <circle cx="19" cy="19" r="13.5" fill="#fff" stroke={NAVY} strokeWidth="3.4" />
      <path d="M19 10.6a7.2 7.6 0 0 1 7.2 7.6H11.8A7.2 7.6 0 0 1 19 10.6z" fill={BLUE} />
      <rect x="9.6" y="18.2" width="18.8" height="2.2" rx="1" fill={NAVY} />
      <g fill={BLUE}>
        <rect x="11.6" y="21" width="2.2" height="5.4" /><rect x="15.8" y="21" width="2.2" height="5.4" />
        <rect x="20" y="21" width="2.2" height="5.4" /><rect x="24.2" y="21" width="2.2" height="5.4" />
      </g>
      <rect x="9.6" y="26.4" width="18.8" height="2.2" rx="1" fill={NAVY} />
      <circle cx="19" cy="8.6" r="1.8" fill={GOLD} />
      <path d="M29 29 38.5 38.5" stroke={NAVY} strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------- the sleuth */
/* The mascot from Chris's mockup: a friendly investigator who says "we follow
   the public records, you draw the conclusion." He is the only face on the
   site, and he never points at anyone. */

export function Sleuth({ size = 96 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden role="presentation">
      <circle cx="48" cy="48" r="46" fill="#f2f7fd" stroke={EDGE} strokeWidth="1.5" />

      {/* coat + collar */}
      <path d="M22 96c1.5-13 10-20 19-22h14c9 2 17.5 9 19 22z" fill="#c39a63" />
      <path d="M41 74l7 9 7-9 5 2-12 20-12-20z" fill="#f0e6d5" />
      <path d="M45.6 83.4 48 96h-4l-1.6-11z" fill="#8f6f45" opacity=".45" />

      {/* ears behind the head */}
      <ellipse cx="24.5" cy="52" rx="7.5" ry="13" fill="#8a6a49" transform="rotate(-14 24.5 52)" />
      <ellipse cx="71.5" cy="52" rx="7.5" ry="13" fill="#8a6a49" transform="rotate(14 71.5 52)" />

      {/* head */}
      <ellipse cx="48" cy="47" rx="22" ry="20" fill="#ab8760" />
      <ellipse cx="48" cy="56.5" rx="13" ry="10" fill="#e7d6bd" />
      <ellipse cx="48" cy="50.5" rx="4.4" ry="3.4" fill="#33271e" />
      <path d="M48 54v3.5M48 57.5c-2.2 2.6-5.6 2.2-6.6-.4M48 57.5c2.2 2.6 5.6 2.2 6.6-.4"
        stroke="#33271e" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <circle cx="39.5" cy="42.5" r="3.6" fill="#fff" />
      <circle cx="56.5" cy="42.5" r="3.6" fill="#fff" />
      <circle cx="40.4" cy="43.2" r="2.2" fill="#2b2118" />
      <circle cx="57.4" cy="43.2" r="2.2" fill="#2b2118" />
      <circle cx="41.2" cy="42.2" r=".8" fill="#fff" />
      <circle cx="58.2" cy="42.2" r=".8" fill="#fff" />

      {/* deerstalker */}
      <path d="M26 34c0-11 9.5-19 22-19s22 8 22 19z" fill="#b8894f" />
      <path d="M31 24.5c3-1 5.5.6 8 .6s4-1.9 7-1.9 4.6 1.9 7 1.9 5-1.6 8-.6"
        stroke="#8f6a38" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="22" y="32" width="52" height="6.4" rx="3.2" fill="#a2763f" />
      <path d="M40 15.5c3-3.5 13-3.5 16 0" stroke="#8f6a38" strokeWidth="2.4"
        fill="none" strokeLinecap="round" />

      {/* magnifier, held up and pointed at nothing in particular */}
      <path d="M82 92 73 80" stroke="#8a6a49" strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="69" cy="74" r="11.5" fill="#dcecff" stroke={NAVY} strokeWidth="4" />
      <path d="M62.5 70c2.2-2.8 7-3.6 10.5-1.4" stroke="#fff" strokeWidth="2.4"
        fill="none" strokeLinecap="round" opacity=".85" />
    </svg>
  )
}

/* -------------------------------------------------- step 1 · sector donors */

export function DonorArt({ sector, size = 96 }: { sector?: string | null; size?: number }) {
  const s = (sector || '').toLowerCase()
  if (s.includes('energy') || s.includes('utilit')) return <BarrelArt size={size} />
  if (s.includes('health') || s.includes('pharma')) return <HealthArt size={size} />
  if (s.includes('agricult') || s.includes('food')) return <FarmArt size={size} />
  if (s.includes('labor') || s.includes('union')) return <LaborArt size={size} />
  if (s.includes('transport')) return <TruckArt size={size} />
  if (s.includes('real estate') || s.includes('construction')) return <BuildArt size={size} />
  if (s.includes('tech') || s.includes('commun')) return <TechArt size={size} />
  if (s.includes('defense') || s.includes('aerospace')) return <DefenseArt size={size} />
  if (s.includes('gun') || s.includes('public safety')) return <SafetyArt size={size} />
  if (s.includes('law') || s.includes('legal')) return <LawArt size={size} />
  if (s.includes('insur')) return <InsuranceArt size={size} />
  if (s.includes('educat')) return <EduArt size={size} />
  if (s.includes('environ')) return <EnvArt size={size} />
  return <BankArt size={size} />
}

export function BarrelArt({ size }: P) {
  return (
    <Scene size={size} ground="#e3dcc8">
      {/* pumpjack + derricks on the horizon */}
      <path d="M6 64V46M14 64V46M6 46h8M6 56h8" stroke="#b9c7d8" strokeWidth="2" />
      <path d="M78 64V44l6 6v14z" fill="#b9c7d8" />
      <path d="M62 64V52h4l6 4v8z" fill="#cdd8e5" />
      <ellipse cx="46" cy="86" rx="22" ry="4" fill="#000" opacity=".07" />
      <path d="M31 30h32v50a5 5 0 0 1-5 5H36a5 5 0 0 1-5-5z" fill={SLATE} />
      <ellipse cx="47" cy="30" rx="16" ry="5.5" fill="#5b6d81" />
      <rect x="29" y="41" width="36" height="5.5" rx="2.7" fill={STONE} />
      <rect x="29" y="63" width="36" height="5.5" rx="2.7" fill={STONE} />
      <path d="M47 50c4.6 5.4 7.2 8.6 7.2 11.8a7.2 7.2 0 0 1-14.4 0c0-3.2 2.6-6.4 7.2-11.8z"
        fill={GOLD} />
    </Scene>
  )
}

export function BankArt({ size }: P) {
  return (
    <Scene size={size}>
      <rect x="8" y="46" width="10" height="18" fill="#c9d8e8" />
      <rect x="80" y="42" width="9" height="22" fill="#c9d8e8" />
      <ellipse cx="48" cy="86" rx="27" ry="4" fill="#000" opacity=".07" />
      <path d="M48 18 79 36H17z" fill={BLUE} />
      <rect x="18" y="36" width="60" height="5" rx="2" fill={NAVY} />
      <g fill="#dce8f5">
        <rect x="25" y="43" width="8" height="27" /><rect x="39" y="43" width="8" height="27" />
        <rect x="53" y="43" width="8" height="27" /><rect x="65" y="43" width="8" height="27" />
      </g>
      <rect x="15" y="70" width="66" height="7" rx="2.5" fill={NAVY} />
      <rect x="11" y="77" width="74" height="5" rx="2" fill="#0d2b53" />
      <circle cx="48" cy="55" r="9" fill={GOLD} />
      <text x="48" y="60.5" textAnchor="middle" fontSize="14" fontWeight="800" fill="#7a5b00">$</text>
    </Scene>
  )
}

export function HealthArt({ size }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="28" ry="4" fill="#000" opacity=".07" />
      <rect x="18" y="34" width="60" height="48" rx="6" fill="#fff" stroke={BLUE} strokeWidth="3" />
      <rect x="18" y="34" width="60" height="10" rx="6" fill={BLUE} />
      <rect x="40" y="24" width="16" height="12" rx="3" fill={SKYB} />
      <g fill="#dbe9f8">
        <rect x="25" y="50" width="10" height="9" rx="2" /><rect x="61" y="50" width="10" height="9" rx="2" />
        <rect x="25" y="64" width="10" height="9" rx="2" /><rect x="61" y="64" width="10" height="9" rx="2" />
      </g>
      <rect x="43" y="52" width="10" height="26" rx="3" fill={RED} />
      <rect x="35" y="60" width="26" height="10" rx="3" fill={RED} />
    </Scene>
  )
}

export function FarmArt({ size }: P) {
  return (
    <Scene size={size} ground="#dfe6cf">
      <circle cx="76" cy="22" r="9" fill={GOLD} />
      <path d="M0 64c10-4 18-4 28 0" stroke="#c3cfae" strokeWidth="2" fill="none" />
      <ellipse cx="44" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <rect x="64" y="34" width="16" height="48" rx="4" fill="#dfe7f0" stroke="#b9c7d8" strokeWidth="2" />
      <path d="M64 34a8 8 0 0 1 16 0z" fill="#b9c7d8" />
      <path d="M14 46 40 26l26 20v36H14z" fill="#d05a5f" />
      <path d="M10 47 40 23l30 24" stroke="#a83f45" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="32" y="58" width="16" height="24" fill="#fff3d6" />
      <path d="M40 58v24M32 70h16" stroke="#c9a24a" strokeWidth="3" />
      <path d="M22 54h10v9H22z" fill="#fff3d6" />
    </Scene>
  )
}

export function LaborArt({ size }: P) {
  return (
    <Scene size={size}>
      <path d="M76 64V24h4v40zM80 26h-16v4h16z" fill="#c9d8e8" />
      <path d="M67 30v10" stroke="#c9d8e8" strokeWidth="2" />
      <ellipse cx="44" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <path d="M20 56c0-15 10.5-26 24-26s24 11 24 26z" fill={GOLD} />
      <path d="M40 30h8v26h-8z" fill={GOLDD} />
      <rect x="14" y="56" width="60" height="10" rx="5" fill={GOLDD} />
      <rect x="26" y="70" width="36" height="12" rx="3" fill={BLUE} />
      <path d="M32 76h24" stroke="#dbe9f8" strokeWidth="2.5" strokeLinecap="round" />
    </Scene>
  )
}

export function TruckArt({ size }: P) {
  return (
    <Scene size={size}>
      <path d="M0 58c14-8 26-8 40 0" stroke="#c9d8e8" strokeWidth="2" fill="none" />
      <path d="M56 58c12-7 24-7 40 0" stroke="#c9d8e8" strokeWidth="2" fill="none" />
      <ellipse cx="48" cy="86" rx="32" ry="4" fill="#000" opacity=".07" />
      <rect x="8" y="40" width="46" height="32" rx="4" fill={BLUE} />
      <rect x="13" y="46" width="36" height="12" rx="2" fill="#dbe9f8" opacity=".65" />
      <path d="M54 48h14l12 14v10H54z" fill={SKYB} />
      <path d="M58 52h9l8 9H58z" fill="#dbe9f8" />
      <rect x="6" y="72" width="80" height="4" rx="2" fill="#9fb3c9" />
      <circle cx="26" cy="76" r="8.5" fill={SLATE} /><circle cx="26" cy="76" r="3.6" fill="#dbe9f8" />
      <circle cx="68" cy="76" r="8.5" fill={SLATE} /><circle cx="68" cy="76" r="3.6" fill="#dbe9f8" />
    </Scene>
  )
}

export function BuildArt({ size }: P) {
  return (
    <Scene size={size}>
      <path d="M74 20v52M74 22h14M88 22v8" stroke="#b9c7d8" strokeWidth="2.5" fill="none" />
      <ellipse cx="44" cy="86" rx="30" ry="4" fill="#000" opacity=".07" />
      <rect x="10" y="42" width="26" height="40" fill={SKYB} />
      <rect x="38" y="26" width="28" height="56" fill={BLUE} />
      <rect x="66" y="52" width="16" height="30" fill="#7fb0ea" />
      <g fill="#e8f1fb">
        <rect x="15" y="48" width="6" height="6" /><rect x="25" y="48" width="6" height="6" />
        <rect x="15" y="60" width="6" height="6" /><rect x="25" y="60" width="6" height="6" />
        <rect x="43" y="33" width="6" height="6" /><rect x="55" y="33" width="6" height="6" />
        <rect x="43" y="46" width="6" height="6" /><rect x="55" y="46" width="6" height="6" />
        <rect x="43" y="59" width="6" height="6" /><rect x="55" y="59" width="6" height="6" />
        <rect x="70" y="58" width="6" height="6" /><rect x="70" y="69" width="6" height="6" />
      </g>
    </Scene>
  )
}

export function TechArt({ size }: P) {
  return (
    <Scene size={size}>
      <path d="M82 60V34l-5 26zM77 34l5 26" stroke="#b9c7d8" strokeWidth="2" fill="none" />
      <path d="M74 30a10 10 0 0 1 14 0" stroke="#b9c7d8" strokeWidth="2" fill="none" />
      <ellipse cx="44" cy="86" rx="28" ry="4" fill="#000" opacity=".07" />
      <rect x="12" y="30" width="60" height="42" rx="5" fill={NAVY} />
      <rect x="17" y="35" width="50" height="32" rx="3" fill={SKYB} />
      <rect x="28" y="76" width="28" height="5" rx="2.5" fill={SLATE} />
      <circle cx="32" cy="47" r="4.2" fill={GOLD} /><circle cx="52" cy="47" r="4.2" fill={GOLD} />
      <circle cx="42" cy="59" r="4.2" fill={GOLD} />
      <path d="M32 47h20M32 47l10 12M52 47 42 59" stroke={GOLD} strokeWidth="2.4" />
    </Scene>
  )
}

export function DefenseArt({ size }: P) {
  return (
    <Scene size={size}>
      <path d="M4 26l18 6-18 6z" fill="#c9d8e8" />
      <path d="M86 60V44M78 46a8 8 0 0 1 16 0" stroke="#b9c7d8" strokeWidth="2" fill="none" />
      <ellipse cx="46" cy="86" rx="24" ry="4" fill="#000" opacity=".07" />
      <path d="M46 18 74 28v24c0 15-12 24-28 29-16-5-28-14-28-29V28z" fill={BLUE} />
      <path d="M46 24 68 32v20c0 12-9 19-22 23V24z" fill={SKYB} opacity=".55" />
      <path d="M37 51l7 7 14-15" stroke="#fff" strokeWidth="5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </Scene>
  )
}

export function SafetyArt({ size }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="24" ry="4" fill="#000" opacity=".07" />
      <path d="M48 16 76 27v22c0 16-12 26-28 31-16-5-28-15-28-31V27z" fill="#dbe9f8"
        stroke={BLUE} strokeWidth="3" />
      <path d="M48 30v34M34 44h28" stroke={BLUE} strokeWidth="5" strokeLinecap="round" />
      <circle cx="48" cy="47" r="9" fill="none" stroke={NAVY} strokeWidth="2.5" />
    </Scene>
  )
}

export function LawArt({ size }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <rect x="44" y="24" width="8" height="52" rx="3" fill={NAVY} />
      <rect x="26" y="76" width="44" height="7" rx="3" fill={NAVY} />
      <path d="M20 34h56" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
      <path d="M22 34l-8 16h16zM74 34l-8 16h16z" fill={SKYB} />
      <path d="M14 50a8 8 0 0 0 16 0zM66 50a8 8 0 0 0 16 0z" fill={BLUE} />
      <circle cx="48" cy="24" r="5" fill={GOLD} />
    </Scene>
  )
}

export function InsuranceArt({ size }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      {/* a house under cover — protection, not a sales pitch */}
      <path d="M14 46a34 34 0 0 1 68 0z" fill={GOLD} />
      <path d="M14 46c6 0 6 5 11.3 5S31 46 37 46s6 5 11.3 5S54 46 60 46s6 5 11.3 5S76 46 82 46"
        fill="none" stroke={GOLDD} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M46.6 46h3v22h-3z" fill={GOLDD} />
      <path d="M28 68 48 54l20 14v14H28z" fill={BLUE} />
      <path d="M24 69 48 51l24 18" stroke={NAVY} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <rect x="42" y="72" width="12" height="10" rx="1.5" fill="#e8f1fb" />
    </Scene>
  )
}

export function EduArt({ size }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <path d="M48 26 84 42 48 58 12 42z" fill={BLUE} />
      <path d="M26 49v16c0 6 10 10 22 10s22-4 22-10V49L48 60z" fill={SKYB} />
      <path d="M80 45v18" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="80" cy="65" r="3.5" fill={GOLD} />
    </Scene>
  )
}

export function EnvArt({ size }: P) {
  return (
    <Scene size={size} ground="#dbe8d4">
      <circle cx="78" cy="22" r="8" fill={GOLD} />
      <ellipse cx="46" cy="86" rx="24" ry="4" fill="#000" opacity=".07" />
      <rect x="42" y="56" width="8" height="28" rx="3" fill="#8a6a49" />
      <circle cx="46" cy="44" r="20" fill={GREEN} />
      <circle cx="30" cy="52" r="12" fill="#4cc08c" />
      <circle cx="62" cy="52" r="12" fill="#4cc08c" />
      <path d="M46 56V40M46 46l-7-6M46 50l8-7" stroke="#2f7f5c" strokeWidth="2.4"
        strokeLinecap="round" fill="none" />
    </Scene>
  )
}

/* --------------------------------------- step 2 · the rest of the sector */
/* Chris's mockup used a mailbox for the middle stop. Here the middle stop is
   "everyone else in this sector", so: many envelopes, one collection box. */

export function PoolArt({ size = 96 }: P) {
  return (
    <Scene size={size}>
      <g fill="#fff" stroke={EDGE} strokeWidth="1.6">
        <rect x="12" y="16" width="20" height="14" rx="2" transform="rotate(-12 22 23)" />
        <rect x="64" y="16" width="20" height="14" rx="2" transform="rotate(11 74 23)" />
        <rect x="38" y="10" width="20" height="14" rx="2" />
      </g>
      <g stroke={SKYB} strokeWidth="1.6" fill="none">
        <path d="M13 19l9 6 9-8M65 19l9 6 9-8M39 13l9 6 9-6" />
      </g>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <path d="M26 44h44a4 4 0 0 1 4 4v30a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V48a4 4 0 0 1 4-4z"
        fill={BLUE} />
      <path d="M22 44c0-7 5-12 12-12h28c7 0 12 5 12 12z" fill={NAVY} />
      <rect x="34" y="52" width="28" height="5" rx="2.5" fill="#0d2b53" opacity=".55" />
      <path d="M34 66h28M34 74h18" stroke="#dbe9f8" strokeWidth="3" strokeLinecap="round" />
      <path d="M78 34v-8h8" stroke={RED} strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="78" y="24" width="10" height="7" rx="1.5" fill={RED} />
    </Scene>
  )
}

/* -------------------------------------------------- step 3 · the politician */

export function CapitolArt({ size = 96 }: P) {
  return (
    <Scene size={size}>
      <path d="M0 62c12-3 22-3 34 0M62 62c12-3 22-3 34 0" stroke="#c9d8e8" strokeWidth="2" fill="none" />
      <ellipse cx="48" cy="86" rx="32" ry="4" fill="#000" opacity=".07" />
      <rect x="8" y="76" width="80" height="6" rx="2" fill="#b9cde4" />
      <rect x="10" y="82" width="76" height="5" rx="2" fill={NAVY} />
      <rect x="13" y="58" width="70" height="18" fill="#cfe0f2" />
      <rect x="11" y="55" width="74" height="4" rx="1.5" fill="#9fbcdd" />
      <g fill="#fff">
        <rect x="17" y="63" width="5" height="13" /><rect x="25" y="63" width="5" height="13" />
        <rect x="66" y="63" width="5" height="13" /><rect x="74" y="63" width="5" height="13" />
      </g>
      {/* centre block the dome actually sits on */}
      <rect x="32" y="49" width="32" height="27" fill="#b7d2ee" />
      <g fill="#fff">
        <rect x="36" y="58" width="5" height="18" /><rect x="45.5" y="58" width="5" height="18" />
        <rect x="55" y="58" width="5" height="18" />
      </g>
      <path d="M29 49 48 40l19 9z" fill="#9fbcdd" />
      <path d="M34.5 42a13.5 15 0 0 1 27 0z" fill={BLUE} />
      <path d="M40 42a8 10 0 0 1 16 0z" fill={SKYB} opacity=".55" />
      <rect x="44" y="21" width="8" height="8" rx="2" fill={BLUE} />
      <path d="M40 29h16v3H40z" fill={NAVY} />
      <rect x="46.6" y="9" width="2.4" height="12" fill={NAVY} />
      <path d="M49 9h9l-2.6 3.2L58 15.5h-9z" fill={RED} />
      <circle cx="47.8" cy="19" r="2.6" fill={GOLD} />
    </Scene>
  )
}

/* -------------------------------------------------------- step 4 · the vote */

export function VoteArt({ position, size = 96 }: { position?: string; size?: number }) {
  const yes = /^(Yea|Aye|Yes)$/i.test(position || '')
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <rect x="21" y="18" width="54" height="64" rx="6" fill="#c9d8e8" />
      <rect x="24" y="22" width="48" height="56" rx="4" fill="#fff" />
      <rect x="38" y="12" width="20" height="11" rx="4" fill="#9fb3c9" />
      <rect x="42" y="9" width="12" height="6" rx="2.5" fill={STONE} />
      <g stroke="#d6e2ee" strokeWidth="3.4" strokeLinecap="round">
        <path d="M31 34h34" /><path d="M31 43h34" /><path d="M31 52h22" />
      </g>
      <circle cx="62" cy="64" r="15" fill={yes ? GREEN : RED} />
      {yes
        ? <path d="M54.5 64.5 60 70l11-12" stroke="#fff" strokeWidth="4.4" fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M56 58l12 12M68 58 56 70" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" />}
    </Scene>
  )
}

/* ------------------------------------------------------ step 5 · the timing */

export function ClockArt({ size = 96 }: P) {
  return (
    <Scene size={size} sky="#fdf6e4" ground="#f2e6c8">
      <rect x="14" y="52" width="34" height="30" rx="4" fill="#fff" stroke="#d9c48c" strokeWidth="2" />
      <rect x="14" y="52" width="34" height="8" rx="4" fill="#d9c48c" />
      <g fill="#e3d3a4">
        <rect x="19" y="64" width="6" height="5" rx="1" /><rect x="28" y="64" width="6" height="5" rx="1" />
        <rect x="37" y="64" width="6" height="5" rx="1" /><rect x="19" y="72" width="6" height="5" rx="1" />
        <rect x="28" y="72" width="6" height="5" rx="1" />
      </g>
      <ellipse cx="60" cy="86" rx="22" ry="4" fill="#000" opacity=".07" />
      <circle cx="60" cy="44" r="27" fill="#fff" stroke={GOLDD} strokeWidth="4" />
      <circle cx="60" cy="44" r="21" fill="#fffaec" />
      <g stroke="#c9a24a" strokeWidth="2.4" strokeLinecap="round">
        <path d="M60 26v4M60 58v4M42 44h4M74 44h4" />
      </g>
      <path d="M60 30v14l10 6" stroke="#8a6a00" strokeWidth="4.2" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="60" cy="44" r="3.4" fill="#8a6a00" />
    </Scene>
  )
}

/* -------------------------------------------------------- step 6 · the bill */

export function BillArt({ size = 96 }: P) {
  return (
    <Scene size={size}>
      <ellipse cx="48" cy="86" rx="26" ry="4" fill="#000" opacity=".07" />
      <path d="M22 16h38a8 8 0 0 1 8 8v58H30a8 8 0 0 1-8-8z" fill="#fff"
        stroke={BLUE} strokeWidth="3" />
      <path d="M68 24h6v58h-6z" fill="#dbe9f8" />
      <g stroke="#cfdcea" strokeWidth="3.4" strokeLinecap="round">
        <path d="M31 32h28" /><path d="M31 42h28" /><path d="M31 52h28" /><path d="M31 62h18" />
      </g>
      <circle cx="62" cy="70" r="13" fill={BLUE} />
      <path d="M62 62.5 64.4 68l5.6.6-4.2 4 1.2 5.6L62 75.4 57 78.2l1.2-5.6-4.2-4 5.6-.6z"
        fill="#fff" />
    </Scene>
  )
}

/* -------------------------------------------------------------- nav icons */
/* The five-up row from the dark mockup. Lobbying data is not loaded yet, so
   there is no lobbyist icon — we do not put a door on an empty room. */

const NavFrame = ({ children, size = 26 }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden role="presentation">{children}</svg>
)

export function IconPolitician({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <circle cx="16" cy="11" r="6" fill="currentColor" />
      <path d="M5 30c0-6.2 4.9-10.5 11-10.5S27 23.8 27 30z" fill="currentColor" />
      <path d="M16 19.5 18.4 24 16 30l-2.4-6z" fill="#fff" opacity=".85" />
    </NavFrame>
  )
}
export function IconDonor({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <rect x="3" y="8" width="26" height="17" rx="3" fill="currentColor" />
      <path d="M3.5 10.5 16 19l12.5-8.5" stroke="#fff" strokeWidth="2.2" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16.5" r="3.6" fill="#fff" opacity=".9" />
    </NavFrame>
  )
}
export function IconBill({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <path d="M7 3h12l6 6v20H7z" fill="currentColor" />
      <path d="M19 3v6h6" fill="#fff" opacity=".55" />
      <path d="M11 15h10M11 20h10M11 25h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </NavFrame>
  )
}
export function IconIndustry({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <path d="M3 29V15l8 5V15l8 5V8h10v21z" fill="currentColor" />
      <g fill="#fff" opacity=".8">
        <rect x="22" y="13" width="3" height="3" /><rect x="22" y="19" width="3" height="3" />
        <rect x="6" y="22" width="3" height="3" /><rect x="14" y="22" width="3" height="3" />
      </g>
    </NavFrame>
  )
}
export function IconEarmark({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <path d="M16 3 29 11v3H3v-3z" fill="currentColor" />
      <rect x="6" y="16" width="4" height="10" fill="currentColor" />
      <rect x="14" y="16" width="4" height="10" fill="currentColor" />
      <rect x="22" y="16" width="4" height="10" fill="currentColor" />
      <rect x="3" y="27" width="26" height="3" rx="1.2" fill="currentColor" />
    </NavFrame>
  )
}
export function IconCheckList({ size = 26 }: P) {
  return (
    <NavFrame size={size}>
      <rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor" />
      <path d="M10 16.5l4 4 8-9" stroke="#fff" strokeWidth="2.8" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </NavFrame>
  )
}

/* ------------------------------------------------------------ small badges */

export function ShieldIcon({ size = 40 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M24 5 41 11v14c0 10-7 16-17 19C14 41 7 35 7 25V11z" fill={BLUE} />
      <path d="M17 24l5 5 10-11" stroke="#fff" strokeWidth="4" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function MegaphoneIcon({ size = 40 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="20" fill={BLUE} />
      <path d="M14 21v6h5l9 6V15l-9 6z" fill="#fff" />
      <path d="M32 19a7 7 0 0 1 0 10" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
export function DocIcon({ size = 22 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 2h8l4 4v16H6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 2v4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
export function LockIcon({ size = 22 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2.5" fill="currentColor" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}
export function SearchIcon({ size = 18 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
