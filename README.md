# BrickellHouse Resident Portal

A mobile-friendly resident storefront and management prototype for BrickellHouse Condominium.

## Project Folder

This entire folder is the GitHub/Vercel project root:

```text
C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or\outputs\brickellhouse-portal
```

Upload the **contents of this folder as one GitHub repository**. Do not upload only `index.html` or only the `api` folder.

## Included

- Static resident storefront and management portal
- Vercel serverless functions in `api/`
- Square Web Payments SDK integration locked to Sandbox
- Server-side payment amount calculation and verification
- Legal acceptance, hidden GL mappings, feedback, and order tracking
- Payment success and failure pages
- Setup and deployment documentation

## Required Software

Install these before local Square Sandbox testing:

1. [Git](https://git-scm.com/downloads)
2. [Node.js LTS](https://nodejs.org/)
3. A free [GitHub](https://github.com/) account
4. A [Vercel](https://vercel.com/) account connected to GitHub

## Basic Local Preview

This command previews the static site only:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173/
```

The Python server cannot run `api/`, so paid checkout is unavailable in this mode.

## Local Square Sandbox Test

1. Create `.env.local` in this project folder.
2. Add your private Sandbox values using the variable names in `.env.example`.
3. From this project folder, run:

```powershell
npx vercel dev --listen 4173
```

4. Complete Vercel’s first-time login/link prompts.
5. Open `http://localhost:4173/`.

Never commit `.env.local`. It is protected by `.gitignore`.

See [SQUARE_SETUP.md](SQUARE_SETUP.md) for the card and verification procedure.

## Important Files

- `.env.example` - required environment-variable names
- `.gitignore` - excludes credentials and local Vercel state
- `api/` - secure Square Sandbox backend routes
- `SQUARE_SETUP.md` - Sandbox testing instructions
- `DEPLOYMENT.md` - GitHub and Vercel setup
- `SUPABASE_MIGRATION.md` - future persistent database design
- `SUPABASE_AUTH_SETUP.md` - management login, approved users, and RLS setup

## Current Limitation

Orders and management data are still stored in the browser’s `localStorage`. Square Sandbox payment creation is server-side, but Supabase must become the permanent order database before production use.

Live Square payments are disabled in code and must not be activated.
