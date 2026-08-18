# RightsTrigger

**Your AI consumer advocate.** RightsTrigger is a local-first web app for organizing purchases, tracking evidence-backed return/warranty dates, surfacing upcoming actions, and preparing a ProofAgent evidence summary.

## What works in this build

- 2-step optional onboarding (name, country, region)
- No account required
- Local IndexedDB storage for profiles, purchases, and uploaded source files
- Receipt/order upload: images, PDFs, text files
- Browser OCR for images using Tesseract.js
- Browser PDF text extraction using PDF.js
- Automatic extraction of common receipt fields
- Required review/edit step before saving
- Evidence-backed return/warranty tracking
- Explicit **Not verified** state when no policy evidence exists
- Action Center for approaching deadlines and missing evidence
- ProofAgent evidence-readiness workflow
- Purchase search and detail pages
- Full local backup/restore, including attached files
- Local data deletion
- Mobile/desktop responsive UI
- Installable PWA shell / offline navigation after first load

## Zero-cost architecture

No API keys are required for this V1. The app can be hosted on GitHub Pages. Data is stored in IndexedDB in the user's browser by default.

Two libraries are loaded from public CDNs when needed:
- Tesseract.js for image OCR
- PDF.js for PDF text extraction

If those external libraries cannot load, **manual purchase entry remains functional**. This is intentional so the core product does not fail behind a hidden API dependency.

## Important limitation

The local-only V1 does **not** automatically fetch current retailer policies from the web. Users can supply an official policy/warranty document, paste policy text, or enter a known deadline. RightsTrigger intentionally does not guess retailer policies.

## Deploy

Publish the `main` branch root with GitHub Pages. No build command is required.

## Privacy

The website can be publicly hosted while the user's profile, purchase records, and uploaded files remain in browser storage on their own device by default.