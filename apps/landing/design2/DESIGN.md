---
name: Genoma Core
colors:
  surface: '#fbf8ff'
  surface-dim: '#dad9e2'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2fc'
  surface-container: '#eeedf6'
  surface-container-high: '#e9e7f0'
  surface-container-highest: '#e3e1eb'
  on-surface: '#1a1b22'
  on-surface-variant: '#45474c'
  inverse-surface: '#2f3037'
  inverse-on-surface: '#f1f0f9'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#565f71'
  primary: '#040d1c'
  on-primary: '#ffffff'
  primary-container: '#1a2333'
  on-primary-container: '#818a9e'
  inverse-primary: '#bec7dc'
  secondary: '#006a63'
  on-secondary: '#ffffff'
  secondary-container: '#6ff4e8'
  on-secondary-container: '#006f68'
  tertiary: '#140a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#2e2009'
  on-tertiary-container: '#9c8668'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2f9'
  primary-fixed-dim: '#bec7dc'
  on-primary-fixed: '#131c2b'
  on-primary-fixed-variant: '#3e4758'
  secondary-fixed: '#72f7eb'
  secondary-fixed-dim: '#51dbcf'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#00504b'
  tertiary-fixed: '#f9dfbb'
  tertiary-fixed-dim: '#dcc3a1'
  on-tertiary-fixed: '#261904'
  on-tertiary-fixed-variant: '#55442a'
  background: '#fbf8ff'
  on-background: '#1a1b22'
  surface-variant: '#e3e1eb'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  code-md:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin: 32px
---

## Brand & Style

The design system is engineered to bridge the gap between high-velocity SaaS innovation and the rigorous, trustworthy nature of clinical healthcare. It evolves the brand from a stark, "hacker-dark" aesthetic into a sophisticated "Modern Medical" experience that feels as reliable in a human hospital as it does in a veterinary clinic.

The visual direction follows a **Corporate Minimalist** movement with **High-Tech accents**. It prioritizes extreme clarity, reducing cognitive load for clinicians while using the signature orange-red to highlight critical data points and urgent actions. The mood is precise, clinical, and data-driven, yet softened by a warm photographic style and human-centric layout patterns.

Key attributes include:
- **Trustworthy Innovation:** Combining deep, stable neutrals with vibrant technology-focused accents.
- **Precision Layouts:** Information density is managed through a clear hierarchy and card-based containment.
- **Dual-Context Utility:** A system that feels professional and native to both human medical software and modern veterinary practices.

## Colors

The palette transitions the brand from pure black to a **Medical Slate** (`#1A2333`), which provides a softer, more professional foundation for complex dashboard interfaces. The **Signature Orange-Red** (`#FF3B2F`) is retained from the legacy brand but used with clinical restraint—reserved exclusively for high-impact CTAs, alerts, and critical anomalies in health data.

A new **Clinical Teal** (`#2CC1B6`) is introduced as a secondary color to reinforce the health and veterinary context, providing a calming counterpoint to the high-energy primary accent. The neutral palette is rooted in a refined off-white (`#F5F5F7`) to ensure maximum readability in daylight clinical environments, while supporting a "marketing dark" mode utilizing the legacy `#0A0A0C` for high-impact storytelling.

## Typography

The typography system uses a tri-font approach to balance personality with utility. **Manrope** provides a modern, balanced feel for headlines, offering excellent legibility with a slightly technical edge. **Inter** serves as the primary workhorse for body text and data grids, chosen for its neutral, systematic nature and exceptional performance at small sizes.

For data labels, technical metadata, and veterinary specific codes, **Space Grotesk** is utilized. Its geometric, futuristic character emphasizes the "Genoma" aspect of the brand—highlighting the cutting-edge science and AI behind the platform. Line heights are kept generous in body text to prevent visual fatigue during long periods of clinical reporting.

## Layout & Spacing

This design system employs a **12-column fluid grid** for dashboard views and a **fixed-width container (1280px)** for marketing and landing pages. The spacing rhythm is strictly based on an **8px linear scale**, ensuring consistent alignment across disparate UI components.

For complex medical data, the "Medium" (24px) spacing unit is the default for container padding, allowing data to breathe while maintaining high information density. Gutters are fixed at 24px to provide clear visual separation between diagnostic modules and patient records.

## Elevation & Depth

To maintain a clean, clinical feel, elevation is achieved through **tonal layering** and **low-contrast outlines** rather than heavy shadows. The background (`#F5F5F7`) acts as the base floor, with cards and modules sitting on a pure white (`#FFFFFF`) surface.

Depth levels are defined as:
- **Surface 0 (Floor):** The main background.
- **Surface 1 (Card):** White background with a 1px border in `#E5E5E7`.
- **Surface 2 (Popovers/Modals):** White background with a soft, ambient shadow (0px 8px 24px rgba(26, 35, 51, 0.08)) to indicate interaction priority.
- **Interaction:** Hover states on interactive cards should utilize a subtle lift effect or a color-tinted border rather than a drop shadow.

## Shapes

The shape language is defined by **Rounded** corners (8px base). This radius is large enough to feel modern and approachable (essential for the veterinary sector) but sharp enough to remain professional and serious for medical software.

Buttons and high-level containers use the 8px radius, while larger dashboard cards may scale up to 16px (rounded-lg) to create a soft, "app-like" container feel. Inputs and smaller UI widgets strictly follow the 8px standard to maintain a cohesive, systematic appearance.

## Components

### Buttons
- **Primary:** Medical Slate (`#1A2333`) background with white text for standard actions.
- **Critical:** Orange-Red (`#FF3B2F`) for emergency actions or high-priority diagnostic triggers.
- **Secondary:** Outlined Medical Slate or Clinical Teal for secondary navigation.
- **Ghost:** Used for low-priority actions in dense data tables.

### Cards & Containers
Cards are the primary structural unit. They must feature a white background, 1px light-gray border, and an 8px corner radius. Content within cards should follow the 24px internal padding rule.

### Input Fields
Inputs use a minimal style with a 1px border. On focus, the border transitions to Clinical Teal (`#2CC1B6`) to provide a calm, "success-oriented" feedback loop. Error states use the Orange-Red palette for immediate visibility.

### Chips & Badges
Badges are used extensively for status (e.g., "Pending Lab", "Urgent", "Stabilized"). Use low-saturation backgrounds of the brand colors (e.g., 10% opacity Teal) with full-saturation text for a sophisticated, readable look.

### Specialized Health Components
- **Diagnostic Timeline:** A vertical or horizontal stepper using Clinical Teal to track patient progress.
- **Data Visualization:** Charts should use a palette of Teal, Navy, and Slate, reserving Red only for out-of-range or dangerous vitals.
- **Species Toggle:** A clean, icon-based toggle to switch between Human and Veterinary contexts, using the brand’s refined iconography style.