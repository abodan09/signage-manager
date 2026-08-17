# Design concepts

Visual design explorations for the desktop management console. **These are mockups, not the shipping UI** — nothing here is wired to the real server, and the app in `src/renderer/` does not use these styles.

| File | Concept | Covers | Status |
|---|---|---|---|
| [`meridian-1.8.html`](meridian-1.8.html) | **Signage Meridian 1.8** | All eight sections | **Current — build against this one** |
| [`meridian.html`](meridian.html) | Signage Meridian | The old five sections | Superseded, kept for provenance |

**Use `meridian-1.8.html`.** The original was drawn against v1.7.0's five-section sidebar, before Apps, Screen Layouts and Emergency existed. It is kept only to show where the direction came from. Building the UI against it would reproduce an app that is a version behind.

Open the file directly in a browser. It is fully self-contained: no build step, no network requests, no fonts or scripts to fetch. It uses Windows system fonts (Segoe UI Variable, Consolas) and inline SVG icons only.

## What Meridian is

Meridian is a hybrid of two of four directions that were explored:

- **Regent** — elegant / corporate. Deep navy sidebar against a light canvas, sapphire accent, layered soft shadows, one primary action per view. Drawn from the Stripe Dashboard silhouette and Linear's restraint.
- **Pulsar** — futuristic. Near-black canvas, glass panels, cyan glow, a fleet ring gauge, and sci-fi FUI corner brackets marking the selected screen. Drawn from Vercel/Geist reduction and Territory Studio's interface work.
- **Paper** — clean / minimal. Warm paper ground, no shadows anywhere, hierarchy by size and weight only, and a hard cap of one safety-orange accent per view. Drawn from Things 3, Dieter Rams, and Teenage Engineering's constraint-as-identity.
- **Meridian** — *this file*. Pulsar's structure wearing Regent's skin.

Meridian keeps Pulsar's information design — the icon rail, the fleet ring gauge, the 24-hour sparkline, the monitoring-wall device grid with live preview thumbnails, the corner-bracket targeting motif on the selected screen, and the monospace technical readouts (`FLEET // 6 OF 8 ONLINE`) — and renders all of it in Regent's light corporate palette.

The exercise was informative on its own: Pulsar's brackets and mono readouts turned out to be *structural* ideas rather than stylistic ones, carrying the same meaning in sapphire on white as in cyan on black. The glow was the only genuinely dark-native part, and it was dropped rather than translated.

Three effects were removed instead of recolored, because on a light ground they read as smudges rather than atmosphere: the nav glow bar, the pairing-card light sweep, and the thumbnail scanline sheen. Offline screens are marked with a status pill, a greyscaled thumbnail, and a white-on-dark `NO SIGNAL` chip rather than by fading the card, which cost too much contrast on white.

## Tokens

Everything derives from custom properties on `:root`. The essentials:

| Role | Value |
|---|---|
| Canvas | `#F7F8FA` |
| Card surface | `#FFFFFF` |
| Sidebar | `#161D35` |
| Ink / muted text | `#1A1F36` / `#5B6178` |
| Hairline | `#E6E8F0` |
| Accent (sapphire) | `#3E63DD`, hover `#5373E7` |
| Online / warning / offline | `#22A06B` / `#D97706` / `#DC2626` |

Semantic **text** uses the darker `--ok-text` / `--warn-text` / `--danger-text` variants (`#15803D`, `#B45309`, `#B91C1C`), because the pure hues fall below 4.5:1 on white. The saturated values are reserved for dots, fills, and stripes where contrast ratios don't apply.

Type is `Segoe UI Variable Text` for body and `Segoe UI Variable Display` for headings, with Stripe-style size-proportional negative tracking (−0.5px at 24px and above, −0.25px at 18px). Numerals and identifiers are `Consolas` with `tabular-nums`. Elevation is a hairline border plus a layered soft shadow, never a glow.

## Status: behind the current app

Meridian was designed against **v1.7.0**, when the sidebar had five sections: Dashboard, Content Library, Templates, Devices, Settings.

**v1.8.0 added three more** — Apps, Screen Layouts, and Emergency — so the mockup is now an information-architecture version behind. It remains valid as a *design language* proposal, but a rebuild would need to cover:

- **Apps** — a gallery of the 21 live-source boards, and the per-app config form
- **Screen Layouts** — the zone editor
- **Emergency** — the most interesting unsolved problem, since an active override is a high-alert state each direction would express very differently. Regent would want a restrained amber banner; Pulsar a genuine alert condition across the monitoring wall; Paper would have to spend its single orange element on it.

The mockup's sample data (8 screens, 6 online, pairing code `WXK-742`, 12 content items) is realistic but fabricated, and mirrors the real data model in `src/renderer/types.ts`.
