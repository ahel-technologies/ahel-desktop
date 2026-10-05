/**
 * Regenerate every Ahel brand asset of the desktop and Web shells from one vector source.
 *
 * The tile geometry is `ahel/design/project/assets/Logos/ahel-tile.svg` (viewBox 195 228 157 157,
 * two fixed inks); the wordmark is lowercase "ahel" in Prime Regular and the installer label
 * "desktop" in Prime Light, both converted to outlines so no font is needed at render time.
 * Run `pnpm exec tsx scripts/render-brand-assets.ts` in `apps/desktop` after changing a source;
 * it rewrites the SVG sources, their PNG renders, the installer bitmaps, the Web favicons and
 * icons, and `resources/tray-windows.ico` through `render-tray-icon.ts`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries, TRAY_ICON_PATHS } from './render-tray-icon.ts'

const RED = '#e42238'
const CREAM = '#f6f1e7'
/** Ahel Studio inks: light ink and muted, dark ink and muted. */
const INK = { light: '#1b2433', lightMuted: '#5b6678', dark: '#f1f2f5', darkMuted: '#a4abb8' } as const

/** Tile source coordinates: the logo SVG's viewBox origin and edge. */
const TILE_ORIGIN = { x: 195, y: 228 }
const TILE_EDGE = 157
/**
 * Corner radius of the red square in viewBox units. The logo file traces the square's corners
 * by hand, which shows as uneven bevels at app-icon sizes; the icons draw the same 157-unit
 * square as a true rounded rectangle and keep the glyph geometry unchanged.
 */
const TILE_RADIUS = 18
/** The chain-link glyph: the two cut-outs of the logo path, as absolute subpaths. */
const TILE_GLYPH_PATHS = [
  'M3095 3659 c65 -24 132 -87 166 -156 34 -70 34 -197 -1 -268 -23 -47 -261 -305 -281 -305 -5 0 -9 51 -9 113 l0 113 61 59 c73 72 89 100 89 157 0 103 -108 170 -198 124 -26 -13 -231 -219 -318 -319 -50 -57 -76 -60 -104 -14 -23 37 -25 63 -8 121 14 50 278 325 343 358 85 44 173 50 260 17z',
  'M2884 3197 c26 -35 36 -253 16 -322 -16 -53 -203 -245 -275 -283 -69 -36 -186 -38 -260 -4 -136 62 -207 210 -171 352 21 83 39 109 135 205 l81 80 0 -41 c0 -23 11 -62 26 -92 l26 -52 -51 -55 c-75 -83 -80 -148 -17 -211 74 -74 131 -61 253 59 97 95 110 117 68 117 -92 0 -122 74 -57 138 20 21 58 62 85 91 57 63 103 69 141 18z',
] as const
/** Logo path transform from its 0.1-unit trace space into the viewBox. */
const TRACE_TRANSFORM = 'translate(0,619) scale(0.1,-0.1)'

/** Lowercase "ahel" in Prime Regular, tracked -0.02em; y 0 is the cap line, 750 the baseline. */
const WORDMARK_PATH = 'M307 250L97 250L97 321C97 327 102 332 108 332L307 332C346 332 367 359 367 391L367 416C367 422 362 427 356 427L187 427C106 427 41 492 41 573L41 604C41 685 106 750 187 750L421 750C439 750 453 736 453 718L453 390C453 299 388 250 307 250ZM128 606L128 569C128 536 154 510 187 510L341 510C352 509 362 504 367 495L367 654C367 660 363 665 357 665L187 665C154 665 128 639 128 606ZM553 739C553 745 558 750 564 750L640 750L640 384C642 357 662 336 688 333L828 333C861 333 887 359 887 392L887 739C887 745 892 750 898 750L974 750L974 390C974 296 915 250 835 250L708 250C677 250 652 265 640 282L640 11C640 5 635 0 629 0L553 0ZM1217 750L1476 750L1476 678C1476 672 1471 667 1465 667L1217 667C1184 667 1158 641 1158 608L1158 519C1167 531 1181 538 1197 538L1471 538C1495 538 1497 524 1497 507L1497 392C1497 299 1432 250 1351 250L1217 250C1136 250 1071 299 1071 392L1071 604C1071 685 1136 750 1217 750ZM1217 332L1354 332C1393 332 1412 351 1412 391L1412 445C1412 451 1407 456 1401 456L1168 456C1162 455 1158 451 1158 445L1158 391C1158 351 1184 332 1217 332ZM1675 0L1599 0L1599 739C1599 745 1604 750 1610 750L1686 750L1686 11C1686 5 1681 0 1675 0Z'
const WORDMARK_BOX = { x: 41, width: 1645, height: 750 }
/** Lowercase "desktop" in Prime Light, same units; descenders reach y 994. */
const DESKTOP_PATH = 'M410 0C404 0 399 5 399 11L399 269C398 258 385 250 371 250L176 250C107 250 52 306 52 375L52 625C52 694 107 750 176 750L433 750C439 750 444 745 444 739L444 0ZM176 708C132 708 97 673 97 629L97 371C97 327 132 291 176 291L382 291C391 292 398 299 399 309L399 708ZM669 750L937 750L937 718C937 712 932 707 926 707L669 707C625 707 590 672 590 628L590 506L591 506C596 513 604 518 613 518L934 518C940 518 945 513 945 506L945 370C945 295 892 250 824 250L666 250C598 250 545 295 545 370L545 629C545 705 600 750 669 750ZM666 291L824 291C867 291 900 327 900 371L900 476L601 476C594 475 590 471 590 465L590 371C590 327 623 291 666 291ZM1383 576L1383 641C1383 684 1345 708 1302 708L1044 708C1038 708 1033 713 1033 719L1033 750L1302 750C1370 750 1426 710 1426 640L1426 564C1426 548 1414 531 1399 526L1089 414C1084 412 1079 406 1079 400L1079 363C1079 319 1114 291 1158 291L1377 291C1383 291 1388 286 1388 280L1388 250L1158 250C1089 250 1034 293 1034 362L1034 412C1034 428 1046 445 1061 450L1373 562C1378 563 1383 570 1383 576ZM1790 487C1830 464 1868 422 1868 377L1868 249L1834 249C1828 249 1823 254 1823 260L1823 381C1823 425 1774 460 1730 460L1601 460C1587 460 1576 467 1573 477L1573 82C1573 76 1568 71 1562 71L1528 71L1528 750L1562 750C1568 750 1573 745 1573 739L1573 519C1574 510 1581 502 1590 502L1727 502L1842 740C1845 745 1851 749 1857 749L1897 749L1773 496ZM2166 708L2077 708C2033 708 1998 672 1998 629L1998 292L2137 292C2143 292 2148 287 2148 281L2148 251L2026 251C2012 251 1999 259 1998 270L1998 9C1998 3 1993 -2 1987 -2L1953 -2L1953 624C1953 694 2008 750 2077 750L2176 750L2176 719C2176 713 2171 708 2166 708ZM2368 757L2519 757C2587 757 2642 701 2642 632L2642 369C2642 300 2587 243 2519 243L2368 243C2299 243 2244 300 2244 369L2244 632C2244 701 2299 757 2368 757ZM2368 285L2519 285C2562 285 2597 321 2597 365L2597 636C2597 680 2562 715 2519 715L2368 715C2324 715 2289 680 2289 636L2289 365C2289 321 2324 285 2368 285ZM3014 250L2757 250C2751 250 2746 255 2746 261L2746 994L2780 994C2786 994 2791 989 2791 983L2791 731C2793 742 2805 750 2819 750L3014 750C3083 750 3138 698 3138 628L3138 373C3138 301 3083 250 3014 250ZM3093 628C3093 672 3058 708 3014 708L2808 708C2799 707 2792 700 2791 691L2791 291L3014 291C3058 291 3093 327 3093 371Z'
const DESKTOP_BOX = { x: 52, width: 3086 }

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const OUT = {
  resources: root('../resources/'),
  installer: root('../installer/assets/'),
  renderer: root('../renderer/assets/'),
  web: root('../../web/public/'),
}

/**
 * Draw the logo tile into a square box.
 * @param x - box left edge.
 * @param y - box top edge.
 * @param edge - box edge length.
 * @returns SVG markup: red rounded square plus the cream glyph.
 */
function tile(x: number, y: number, edge: number): string {
  const place = `translate(${x} ${y}) scale(${edge / TILE_EDGE}) translate(${-TILE_ORIGIN.x} ${-TILE_ORIGIN.y})`
  const glyph = TILE_GLYPH_PATHS.map(d => `<path d="${d}"/>`).join('')
  return `<g transform="${place}"><rect x="${TILE_ORIGIN.x}" y="${TILE_ORIGIN.y}" width="${TILE_EDGE}" height="${TILE_EDGE}" rx="${TILE_RADIUS}" fill="${RED}"/>`
    + `<g transform="${TRACE_TRANSFORM}" fill="${CREAM}" stroke="none">${glyph}</g></g>`
}

/**
 * Place an outlined word with its cap line at `y`.
 * @returns SVG path markup.
 */
function word(path: string, box: { x: number }, x: number, y: number, capHeight: number, fill: string): string {
  const scale = capHeight / WORDMARK_BOX.height
  return `<path fill="${fill}" transform="translate(${x} ${y}) scale(${scale}) translate(${-box.x} 0)" d="${path}"/>`
}

function svg(width: number, height: number, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">${extra}${body}</svg>\n`
}

/** macOS app icon: 824-unit tile centred on the 1024 canvas (Big Sur grid) with the template shadow. */
function macosIcon(): string {
  const shadow = '<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">'
    + '<feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/>'
    + '<feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>'
    + '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
  return svg(1024, 1024, `<g filter="url(#shadow)">${tile(100, 100, 824)}</g>`, shadow)
}

/**
 * Windows and runtime icon: near full-bleed tile.
 * @param trayGroup - wrap the tile in the \`tray-glyph\` group that \`render-tray-icon.ts\` enlarges
 *   1.2x for the tray; the enlarged tile overfills the canvas, so the tray shows the largest glyph
 *   on a red ground.
 */
function windowsIcon(trayGroup = false): string {
  const body = tile(32, 32, 960)
  return svg(1024, 1024, trayGroup ? `<g id="tray-glyph">${body}</g>` : body)
}

/** Maskable Web icon: full-bleed red with the glyph inside the 80 % safe zone. */
function maskableIcon(): string {
  return svg(512, 512, `<rect width="512" height="512" fill="${RED}"/>${tile(76, 76, 360)}`)
}

/** Tile plus "ahel" at the header proportions (30 px tile, 9 px gap, 25 px wordmark). */
function lockup(x: number, y: number, tileEdge: number, ink: string): { markup: string; width: number } {
  const cap = tileEdge * (25 / 30) * 0.75
  const gap = tileEdge * (9 / 30)
  const wordWidth = WORDMARK_BOX.width * cap / WORDMARK_BOX.height
  const markup = tile(x, y, tileEdge) + word(WORDMARK_PATH, WORDMARK_BOX, x + tileEdge + gap, y + (tileEdge - cap) / 2, cap, ink)
  return { markup, width: tileEdge + gap + wordWidth }
}

/** Welcome window lockup in the 472x40 box the welcome page reserves; ink follows the color scheme. */
function welcomeBrand(): string {
  const style = `<style>.ink{fill:${INK.light}}@media (prefers-color-scheme: dark){.ink{fill:${INK.dark}}}</style>`
  const probe = lockup(0, 0, 40, '')
  const placed = lockup((472 - probe.width) / 2, 0, 40, 'currentColor').markup.replace('fill="currentColor"', 'class="ink"')
  return svg(472, 40, placed, style)
}

/**
 * Installer banner: tile above the "ahel desktop" lockup on a transparent ground.
 * @param scale - 1 for 600x196, 2 for 1200x392.
 * @param dark - whether the installer paints a dark ground behind it.
 */
function installerBrand(scale: number, dark: boolean): string {
  const width = 600 * scale
  const height = 196 * scale
  const tileEdge = 92 * scale
  const cap = 22 * scale
  const gap = 8 * scale
  const ahelWidth = WORDMARK_BOX.width * cap / WORDMARK_BOX.height
  const deskWidth = DESKTOP_BOX.width * cap / WORDMARK_BOX.height
  const rowX = (width - ahelWidth - gap - deskWidth) / 2
  const rowY = 140 * scale
  return svg(width, height, tile((width - tileEdge) / 2, 22 * scale, tileEdge)
    + word(WORDMARK_PATH, WORDMARK_BOX, rowX, rowY, cap, dark ? INK.dark : INK.light)
    + word(DESKTOP_PATH, DESKTOP_BOX, rowX + ahelWidth + gap, rowY, cap, dark ? INK.darkMuted : INK.lightMuted))
}

/** Uninstaller sidebar: the tile centred on white (the NSIS sidebar bitmap is 24-bit). */
function uninstallerSidebar(): string {
  return svg(164, 314, `<rect width="164" height="314" fill="#ffffff"/>${tile(34, 109, 96)}`)
}

async function write(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

async function png(source: string, size: { width: number; height: number }, path: string, flatten?: string): Promise<void> {
  // Density scales the SVG's own size to the requested bitmap so curves rasterize at full resolution.
  const width = Number(/width="(\d+)"/.exec(source)?.[1])
  let image = sharp(Buffer.from(source), { density: 72 * size.width / width }).resize(size.width, size.height)
  if (flatten !== undefined) image = image.flatten({ background: flatten }).removeAlpha()
  await write(path, await image.png({ compressionLevel: 9 }).toBuffer())
}

async function main(): Promise<void> {
  const square = (edge: number) => ({ width: edge, height: edge })
  const sources = {
    macos: macosIcon(),
    windows: windowsIcon(true),
    runtime: windowsIcon(),
    favicon: svg(TILE_EDGE, TILE_EDGE, tile(0, 0, TILE_EDGE)),
  }
  await write(resolve(OUT.resources, 'icon-macos.svg'), sources.macos)
  await write(resolve(OUT.resources, 'icon-windows.svg'), sources.windows)
  await write(resolve(OUT.resources, 'icon.svg'), sources.runtime)
  await png(sources.macos, square(1024), resolve(OUT.resources, 'icon-macos.png'))
  await png(sources.windows, square(1024), resolve(OUT.resources, 'icon-windows.png'))
  await png(sources.runtime, square(1024), resolve(OUT.resources, 'icon.png'))
  await png(sources.runtime, square(512), resolve(OUT.resources, 'icon-linux-512.png'))

  for (const [name, scale, dark] of [['brand', 1, false], ['brand-2x', 2, false], ['brand-dark', 1, true], ['brand-dark-2x', 2, true]] as const) {
    await png(installerBrand(scale, dark), { width: 600 * scale, height: 196 * scale }, resolve(OUT.installer, `${name}.png`))
  }
  await png(uninstallerSidebar(), { width: 164, height: 314 }, resolve(OUT.installer, 'uninstaller-sidebar.png'), '#ffffff')

  await write(resolve(OUT.renderer, 'welcome-brand.svg'), welcomeBrand())

  // The tile carries its own ground, so the light and dark favicons are the same drawing.
  await write(resolve(OUT.web, 'favicon.svg'), sources.favicon)
  await write(resolve(OUT.web, 'favicon-dark.svg'), sources.favicon)
  await png(sources.runtime, square(192), resolve(OUT.web, 'icon-192.png'))
  await png(sources.runtime, square(512), resolve(OUT.web, 'icon-512.png'))
  await png(maskableIcon(), square(512), resolve(OUT.web, 'icon-maskable-512.png'))

  const tray = await renderTrayIconEntries(Buffer.from(sources.windows))
  await writeFile(TRAY_ICON_PATHS.output, packIco(tray))
  console.info('brand assets: wrote resources, installer, renderer, and Web icons')
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
