# 05 - Mattilbud.no Kundeavis-Nedlasting & Teknisk Integrasjonsguide

> **Forfatter:** Subagent A (Mattilbud Nedlastings-Etterforsker)  
> **Mottaker:** Subagent B (Kode- & Skanner-fikser) & Orkestrator  
> **Dato:** 16. november 2026  
> **Status:** Fullført & Verifisert i praksis (**127 ekte sider** lastet ned for uke `2026-W47`)

---

## 1. Sammendrag & Hovedfunn

Vi har fjernet 4-siders grensen og oppgradert nedlastingsmotoren ([`scripts/download-flyers.mjs`](file://scripts/download-flyers.mjs)) slik at den laster ned **ALLE sider (side 1 til N)** for samtlige seks kjeders kundeaviser.

I tillegg støtter scriptet:
- **Ukebasert lagring (`<ÅR>-W<UKE>`)**: Aktiv uke er nå `2026-W47` (16. nov - 22. nov 2026).
- **Parallell batch-nedlasting**: Sider lastes ned i parallelle batcher (6 sider av gangen) for maksimal hastighet.
- **Hotspots/Tilbuds-metadata**: Henter også antall tilbuds-hotspots fra Tjek Squid API (`/v2/catalogs/<id>/hotspots`).
- **Smart cache & automatisk opprydding**: Gjenbruker filer ved cache hit, sletter automatisk eldre uker (`2026-W46` ble automatisk fjernet).

---

## 2. Eksakt Sidetall & Hotspots per Butikkjede (Uke 2026-W47)

Totalt er **127 høyoppløselige sider** og **401 tilbuds-hotspots** lastet ned og lagret lokalt:

| Kjede | Publikasjon ID | Antall Sider Lastet Ned | Tilbuds-Hotspots | Lagringssti |
|---|---|---|---|---|
| **KIWI** | `2XOv2FlP` | **32 sider** (Side 1–32) | 126 hotspots | `data/flyers/2026-W47/kiwi/` |
| **REMA 1000** | `Hpxm4IbL` | **4 sider** (Side 1–4) | 4 hotspots | `data/flyers/2026-W47/rema-1000/` |
| **Extra (Coop)** | `xoETC3S4` | **30 sider** (Side 1–30) | 125 hotspots | `data/flyers/2026-W47/extra/` |
| **MENY** | `Og-MGv8x` | **13 sider** (Side 1–13) | 57 hotspots | `data/flyers/2026-W47/meny/` |
| **SPAR** | `-kXXIz7F` | **21 sider** (Side 1–21) | 55 hotspots | `data/flyers/2026-W47/spar/` |
| **Joker** | `kNwR7EI9` | **27 sider** (Side 1–27) | 34 hotspots | `data/flyers/2026-W47/joker/` |
| **TOTALT** | | **127 sider** | **401 hotspots** | |

*Samtlige filer er også automatisk speilet til `public/data/flyers/2026-W47/` for webvisning.*

---

## 3. Mappestruktur & Filer på Disk

```
data/flyers/
├── latest-week.json                       <-- Peker til aktiv uke: 2026-W47
└── 2026-W47/                              <-- Aktiv uke (16. nov - 22. nov 2026)
    ├── download_summary.json              <-- Samlet ukemanifest for alle 127 sidene
    ├── kiwi/
    │   ├── manifest.json
    │   └── kiwi_2026-W47_page-1..32.webp
    ├── rema-1000/
    │   ├── manifest.json
    │   └── rema-1000_2026-W47_page-1..4.webp
    ├── extra/
    │   ├── manifest.json
    │   └── extra_2026-W47_page-1..30.webp
    ├── meny/
    │   ├── manifest.json
    │   └── meny_2026-W47_page-1..13.webp
    ├── spar/
    │   ├── manifest.json
    │   └── spar_2026-W47_page-1..21.webp
    └── joker/
        ├── manifest.json
        └── joker_2026-W47_page-1..27.webp
```

---

## 4. Konklusjon
Oppdraget er 100% fullført. Alle sider for alle seks kjeders kundeaviser ligger nå fysisk lagret på disk, klare for AI Vision og tilbudsanalyser.
