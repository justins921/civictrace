/* One source of truth for the header links, imported by both the server-rendered
   header and the client-side mobile menu. If these ever drift apart, a phone and
   a laptop start showing different sites. */
import {
  IconPolitician, IconDonor, IconBill, IconIndustry, IconEarmark, IconCheckList,
} from '@/components/Art'

/* Lobbyists are deliberately absent: Senate LDA filings are not loaded yet, and
   a nav item that leads to an empty page is a promise the data does not keep.
   It goes back in when the data does. */
export const ENTITY_NAV = [
  { href: '/delegation', label: 'Politicians', Icon: IconPolitician, blurb: 'Wisconsin’s ten members of Congress' },
  { href: '/donors', label: 'Donors', Icon: IconDonor, blurb: 'Every committee that gave to one of them' },
  { href: '/bills', label: 'Bills', Icon: IconBill, blurb: 'Every bill they took a position on' },
  { href: '/industries', label: 'Industries', Icon: IconIndustry, blurb: 'Money grouped by a published rule' },
  { href: '/trails', label: 'Money trails', Icon: IconCheckList, blurb: 'Where money and a vote overlap' },
  { href: '/earmarks', label: 'Earmarks', Icon: IconEarmark, blurb: 'FY2026 project requests, as disclosed' },
]

export const SUB_NAV = [
  { href: '/votes', label: 'Every vote' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/methodology#sources', label: 'Data sources' },
  { href: '/corrections', label: 'Corrections' },
  { href: '/contact', label: 'Report an error' },
]
