---
name: Salapi
description: A clear household budget, from daily expenses to monthly obligations.
colors:
  primary: "var(--ion-color-primary)"
  on-primary: "var(--ion-color-primary-contrast)"
  primary-ink: "var(--plan-accent-ink)"
  paper: "var(--plan-paper)"
  surface: "var(--plan-surface)"
  surface-muted: "var(--plan-surface-muted)"
  ink: "var(--plan-ink)"
  muted: "var(--plan-muted)"
  rule: "var(--plan-rule)"
  grid: "var(--plan-grid)"
  success: "var(--plan-success)"
  warning: "var(--plan-warning)"
  danger: "var(--plan-danger)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(2rem, 4vw, 2.65rem)"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
rounded:
  compact: "7px"
  control: "8px"
  panel: "10px"
spacing:
  page-gutter: "clamp(16px, 2.4vw, 36px)"
  page-max-width: "1440px"
  navigation-rail-width: "224px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "14px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
    height: "48px"
  selected-chip:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "8px 12px"
---

# Design System: Salapi

## Overview

**Creative North Star: “Residential planning sheets.”**

Salapi presents household finances as calm, legible planning pages. Paper-like canvases, fine rules, and aligned amounts make income, spending, and obligations easy to compare without adding visual noise. The same information hierarchy adapts from a compact Android screen to a wide browser window.

The accent follows the user's selected palette; light and dark appearances share the same semantic color roles. Financial records remain the focus, while the interface uses restrained status color, touch-sized controls, and visible keyboard focus.

**Key Characteristics:**
- Information-first layouts with tabular financial amounts.
- Flat, ruled surfaces and a restrained accent palette.
- A compact bottom navigation bar that becomes a desktop navigation rail.

## Colors

The palette is built from semantic surface and text tokens, with the primary accent following the selected color palette and appearance mode.

### Primary
- **Selected accent** (`var(--ion-color-primary)`): Primary actions and selected navigation, filter, and palette states; the color is user-selectable rather than fixed.
- **Accent ink** (`var(--plan-accent-ink)`): Readable foreground for selected states, tuned for the current light or dark appearance.

### Neutral
- **Paper** (`var(--plan-paper)`) and **surface** (`var(--plan-surface)`): Page canvas and content panels.
- **Muted surface** (`var(--plan-surface-muted)`): Group headers and selected-but-quiet surfaces.
- **Ink** (`var(--plan-ink)`) and **muted text** (`var(--plan-muted)`): Primary content and supporting labels.
- **Rule** (`var(--plan-rule)`) and **grid** (`var(--plan-grid)`): Fine dividers and the low-contrast planning grid.
- **Success**, **warning**, and **danger** (`--plan-success`, `--plan-warning`, `--plan-danger`): Financial status; these roles are not substitutes for the selected accent.

### Named Rules
**The Accent Follows Preference Rule.** Primary actions and selected states follow the palette and light/dark settings chosen by the user.

## Typography

- **Display Font:** System sans-serif (`-apple-system`, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif)
- **Body Font:** System sans-serif
- **Label/Mono Font:** No separate label or monospaced family; keep the interface readable and consistent.

**Character:** A neutral system face keeps financial information familiar across Android and browser platforms. Tabular numerals and restrained tracking support quick comparison without making the interface feel technical.

### Hierarchy
- **Display** (responsive `clamp(2rem, 4vw, 2.65rem)`): The primary balance and financial snapshot totals.
- **Title** (`1.25rem`): Page titles and the most prominent section headings.
- **Body** (`16px`): Form controls and comfortable primary reading text.
- **Label** (generally `0.7–0.9rem`): Supporting metadata, statuses, and compact navigation labels.

## Layout

The page canvas starts at `320px`, uses a `clamp(16px, 2.4vw, 36px)` gutter, and caps content at `1440px`. At `640px`, dashboard statistics and selected list areas gain columns; at `1024px`, the shell reserves a `224px` left navigation rail and centers page sections in the remaining space. The AI conversation adapts from `768px` and caps wide chat content at `920px`.

Use one consistent information architecture at each size: stack records and controls on compact screens, then use available width for denser grids and page alignment on larger screens. Bottom tabs retain safe-area padding; the navigation rail keeps the same destinations and labels.

## Elevation & Depth

Content panels are flat by default and rely on a one-pixel rule, muted surfaces, and whitespace for grouping. The bottom tab bar and primary floating action button use small structural shadows to remain distinct from scrolling content. A low-contrast `28px` square grid is reserved for the balance hero and financial snapshots; it is not a general card texture.

### Named Rules
**The Rule-First Panel Rule.** Use surface contrast and fine borders before elevation; reserve shadows for persistent or floating controls.

## Shapes

Panels use a restrained `10px` radius, standard Ionic controls use `8px`, and compact month/filter chips use `7px`. Fine one-pixel rules define panel edges and separators. Keep clipping local to containers that contain nested content; do not turn the financial surfaces into heavily rounded tiles.

## Components

### Buttons
- **Shape:** Ionic controls use an `8px` radius and shared minimum `48px` height.
- **Primary:** Use the selected primary accent with its contrast color for the main action.
- **Hover / Focus:** Keep focus visibly outlined with a `3px` primary-accent outline and `2px` offset; do not rely on hover to communicate an action.
- **Secondary / Ghost:** Use Ionic outline or clear variants with the same shape and touch target.

### Chips
- **Style:** Month and filter chips use compact `7px` corners, muted text, and a quiet surface when selected.
- **State:** Selected chips use the ink foreground and muted surface; preserve visible keyboard focus.

### Cards / Containers
- **Corner Style:** `10px` radius.
- **Background:** Solid semantic surface with a fine rule; group headers may use the muted surface.
- **Shadow Strategy:** Flat by default; see Elevation & Depth.
- **Internal Padding:** Common panels use `14px`, with page-specific spacing allowed where the content requires it.

### Inputs / Fields
- **Style:** Ionic form items use the surface color, rule border, and `8px` radius.
- **Focus:** Use the shared visible primary-accent outline and keep native labels and validation feedback.
- **Error / Disabled:** Preserve Ionic semantic error and disabled states; pair color with readable text or control state.

### Navigation
- **Style:** Use the same labeled Home, Expenses, Reports, and Debts destinations at every width. The AI destination is present only on native platforms, where its on-device integration is supported.
- **Mobile:** Bottom tabs with stacked icon and label, safe-area padding, and a thin top rule.
- **Wide screens:** A fixed `224px` left rail with horizontal icon/label rows and a right-hand divider.

### Financial Snapshot
Use tabular numerals for balances and obligations. Reserve the subdued square grid for the balance hero and summary snapshot, keeping the underlying text and status colors readable in both appearances.

## Do's and Don'ts

### Do:
- **Do** use `--plan-*` tokens for surfaces, text, rules, and financial status.
- **Do** let Ionic primary variables reflect the user's selected palette and appearance.
- **Do** keep controls touch-sized and keyboard focus visible.
- **Do** align financial amounts and preserve the responsive page maximum and gutter.

### Don't:
- **Don't** hard-code a single accent color into shared components.
- **Don't** use shadows or heavy rounding as the default panel treatment.
- **Don't** use the planning grid on every card or reduce status meaning to color alone.
- **Don't** hide a core destination at compact widths; adapt the same navigation to the available space.
