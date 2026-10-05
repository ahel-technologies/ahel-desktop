/**
 * ahel.ai's four Knowledge products and the sources each sells. Mirrors
 * `KNOWLEDGE_PRODUCTS` in ahel's src/lib/gateway-pricing.ts, which no public
 * route serves; the sources themselves come live from the public catalog
 * search. A source no product names is sold as Company Check, as on ahel.ai.
 */
import type { KnowledgeProduct, KnowledgeSource } from './types.ts'

/** The catalog id prefix of every Knowledge source. */
export const KNOWLEDGE_ID_PREFIX = 'ahel.datasets/'

type ProductSpec = Omit<KnowledgeProduct, 'sources'> & { readonly packs: readonly string[] }

const PRODUCTS: readonly ProductSpec[] = [
  {
    id: 'company-check',
    name: 'Company Check',
    cents: 3,
    promise: 'Find a company and read what is filed about it: registration, officers, shareholders, beneficial owners, annual accounts, paid taxes, pledges, rulings and notices.',
    includes: 'Estonia in depth. Latvia, Lithuania, Finland, Norway, UK, Germany and France registers. GLEIF identities and US filings.',
    ask: 'Who owns the company with registry code 12345678, and what do its last annual accounts say?',
    glyph: 'building',
    packs: [
      'companies-ee', 'companies-lv', 'companies-lt', 'companies-fi', 'companies-no', 'companies-uk', 'companies-de', 'companies-fr',
      'ee-company-officers', 'ee-company-shareholders', 'ee-beneficial-owners', 'ee-offcard-roles',
      'ee-annual-accounts', 'ee-paid-taxes', 'ee-pledges', 'ee-securities', 'ee-rulings', 'ee-announcements', 'ee-jobs',
      'uk-significant-control', 'global-company-identities', 'global-accounting-relationships', 'us-company-financials',
      'company-research',
    ],
  },
  {
    id: 'screening',
    name: 'Screening',
    cents: 5,
    promise: 'Screen a name or a wallet against official sanctions lists, designated digital-currency addresses, scam reports and exchange address labels. Every hit is a scored possible match, never a conclusion.',
    includes: 'Consolidated sanctions and watchlists, OFAC designated addresses, Ethereum, Solana and Tron address labels, community scam reports.',
    ask: 'Screen this counterparty and this USDT address before we sign.',
    glyph: 'shield-alert',
    packs: ['sanctions-entities', 'ofac-sanctions', 'sanctions-screening', 'crypto-screening', 'ethereum-labels', 'solana-labels', 'tron-labels', 'evm-scam-reports'],
  },
  {
    id: 'market-signals',
    name: 'Tenders and Market Signals',
    cents: 3,
    promise: 'Watch European public tenders, find suppliers by what they do, read market coverage by industry and company size, and see what large investors hold.',
    includes: 'TED contract notices, supplier discovery, market and skills research, superinvestor portfolios.',
    ask: 'List open EU tenders for packaging in the Baltics and three suppliers that could bid.',
    glyph: 'gavel',
    packs: ['public-contract-notices', 'eu-tenders', 'supplier-discovery', 'market-research', 'workforce-skills-research', 'superinvestor-holdings'],
  },
  {
    id: 'security-intel',
    name: 'Security Intelligence',
    cents: 1,
    promise: 'Known exploited vulnerabilities, exploit predictions, ATT&CK techniques and MISP threat references, for triage without a feed subscription.',
    includes: 'CISA KEV, FIRST EPSS, MITRE ATT&CK, MISP galaxies, collected vulnerability and threat intelligence.',
    ask: 'Is this CVE exploited in the wild, and what is its exploit prediction score?',
    glyph: 'bug',
    packs: ['known-exploited-cves', 'epss', 'attack-techniques', 'misp-reference', 'vulnerability-intelligence', 'threat-intelligence'],
  },
]

/**
 * Sort the live sources into the four products, each in the product's own order.
 * @param sources - every Knowledge source the catalog lists.
 * @returns the products; a product with no live source is left out.
 */
export function knowledgeProducts(sources: readonly KnowledgeSource[]): KnowledgeProduct[] {
  const byShort = new Map(sources.map(source => [source.id.slice(KNOWLEDGE_ID_PREFIX.length), source]))
  const claimed = new Set(PRODUCTS.flatMap(product => product.packs))
  const unclaimed = sources.filter(source => !claimed.has(source.id.slice(KNOWLEDGE_ID_PREFIX.length)))
  return PRODUCTS.flatMap(({ packs, ...product }, index) => {
    const own = packs.flatMap(pack => byShort.get(pack) ?? [])
    const all = index === 0 ? [...own, ...unclaimed] : own
    return all.length === 0 ? [] : [{ ...product, sources: all }]
  })
}
