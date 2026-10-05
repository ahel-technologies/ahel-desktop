import { AhelTile } from './AhelTile.tsx'
import type { IconProps } from './icons/props.ts'

/** Lowercase "ahel" in Prime Regular as outlines, tracked -0.02em; cap line y 0, baseline y 750. */
const WORDMARK_PATH = 'M307 250L97 250L97 321C97 327 102 332 108 332L307 332C346 332 367 359 367 391L367 416C367 422 362 427 356 427L187 427C106 427 41 492 41 573L41 604C41 685 106 750 187 750L421 750C439 750 453 736 453 718L453 390C453 299 388 250 307 250ZM128 606L128 569C128 536 154 510 187 510L341 510C352 509 362 504 367 495L367 654C367 660 363 665 357 665L187 665C154 665 128 639 128 606ZM553 739C553 745 558 750 564 750L640 750L640 384C642 357 662 336 688 333L828 333C861 333 887 359 887 392L887 739C887 745 892 750 898 750L974 750L974 390C974 296 915 250 835 250L708 250C677 250 652 265 640 282L640 11C640 5 635 0 629 0L553 0ZM1217 750L1476 750L1476 678C1476 672 1471 667 1465 667L1217 667C1184 667 1158 641 1158 608L1158 519C1167 531 1181 538 1197 538L1471 538C1495 538 1497 524 1497 507L1497 392C1497 299 1432 250 1351 250L1217 250C1136 250 1071 299 1071 392L1071 604C1071 685 1136 750 1217 750ZM1217 332L1354 332C1393 332 1412 351 1412 391L1412 445C1412 451 1407 456 1401 456L1168 456C1162 455 1158 451 1158 445L1158 391C1158 351 1184 332 1217 332ZM1675 0L1599 0L1599 739C1599 745 1604 750 1610 750L1686 750L1686 11C1686 5 1681 0 1675 0Z'
/** Horizontal extent and cap height of {@link WORDMARK_PATH} in font units. */
const WORDMARK_LEFT = 41
const WORDMARK_WIDTH = 1645
const WORDMARK_CAP = 750
/** Geometry at the 24-unit artwork height: the cap height is 60 % of the box, and the mark gap is 8. */
const BOX = 24
const CAP = 14.4
const GAP = 8
const WORD_WIDTH = (WORDMARK_WIDTH * CAP) / WORDMARK_CAP

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading Ahel tile; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the Ahel wordmark, lowercase "ahel", optionally after the logo tile.
 * The letters ride currentColor; the tile keeps its fixed inks.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading tile.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const left = includeMark ? BOX + GAP : 0
  const width = left + WORD_WIDTH
  return (
    <svg
      width={(size * width) / BOX}
      height={size}
      className={className}
      viewBox={`0 0 ${width} ${BOX}`}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && <AhelTile size={BOX} />}
      <path
        d={WORDMARK_PATH}
        fill="currentColor"
        transform={`translate(${left} ${(BOX - CAP) / 2}) scale(${CAP / WORDMARK_CAP}) translate(${-WORDMARK_LEFT} 0)`}
      />
    </svg>
  )
}
